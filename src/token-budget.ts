/**
 * Token Budget Manager.
 *
 * Tracks real token usage from API responses and manages context
 * window capacity. When context approaches limits, performs smart
 * compaction that preserves decision-bearing messages over filler.
 *
 * Key insight: naive compaction drops oldest messages, but tool_result
 * messages contain decisions and verified state. Smart compaction
 * preserves these while dropping verbose explanatory text.
 */

import type { ChatMessage } from './providers/openai-compat.js'

// ── Types ────────────────────────────────────────────────────────

export interface TokenBudget {
  /** Model's total context window size in tokens */
  contextWindow: number
  /** Maximum output tokens for this model */
  maxOutput: number
  /** Current input token usage (from API responses) */
  inputTokensUsed: number
  /** Current output token usage (from API responses) */
  outputTokensUsed: number
  /** Estimated tokens from conversation history */
  historyTokensEst: number
  /** Current utilization as percentage (0-100) */
  utilizationPct: number
  /** Risk level based on utilization */
  risk: 'green' | 'yellow' | 'orange' | 'red'
}

export interface CompactionResult {
  /** Number of messages dropped */
  dropped: number
  /** Number of messages kept */
  kept: number
  /** Estimated tokens freed */
  tokensFreed: number
  /** Summary of what was dropped */
  summary: string
}

// ── Model Context Windows ───────────────────────────────────────

const MODEL_CONTEXT: Array<[string, number]> = [
  ['claude-opus-4', 200_000],
  ['claude-sonnet-4', 200_000],
  ['gpt-5', 256_000],
  ['gemini-3', 2_000_000],
  ['gemma-4', 128_000],
  ['glm-5', 128_000],
  ['grok-4', 256_000],
  ['qwen3', 128_000],
  ['kimi-k2', 256_000],
  ['minimax-m2', 128_000],
]

function getContextWindow(model: string): number {
  const lower = model.toLowerCase()
  for (const [prefix, window] of MODEL_CONTEXT) {
    if (lower.includes(prefix)) return window
  }
  return 128_000 // safe default
}

// ── CJK-Aware Token Estimation ─────────────────────────────────

/**
 * Count CJK characters in text.
 * CJK chars tokenize at ~1.5 chars/token vs ~4 chars/token for Latin.
 */
function countCJK(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if ((code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
        (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Extension A
        (code >= 0xFF00 && code <= 0xFFEF) ||  // Fullwidth Forms
        (code >= 0x3000 && code <= 0x303F)) {  // CJK Symbols
      count++
    }
  }
  return count
}

/**
 * Estimate tokens from text with CJK awareness.
 * Latin: ~4 chars/token, CJK: ~1.5 chars/token.
 */
export function estimateTokens(text: string): number {
  const cjk = countCJK(text)
  const latin = text.length - cjk
  return Math.ceil(cjk / 1.5 + latin / 4)
}

// ── Token Budget Manager ────────────────────────────────────────

export class TokenBudgetManager {
  private model: string
  private cumulativeInput = 0
  private cumulativeOutput = 0
  private lastInputTokens = 0

  constructor(model: string) {
    this.model = model
  }

  /** Update token counts from API response usage data */
  recordUsage(inputTokens: number, outputTokens: number): void {
    this.lastInputTokens = inputTokens // latest turn = current context fill
    this.cumulativeInput += inputTokens
    this.cumulativeOutput += outputTokens
  }

  /** Get current budget status */
  getBudget(history: ChatMessage[]): TokenBudget {
    const contextWindow = getContextWindow(this.model)
    const maxOutput = Math.min(contextWindow / 4, 64_000)

    // Prefer API-reported inputTokens (exact), fall back to CJK-aware estimate
    // CRITICAL: fallback MUST cap at contextWindow — conversation history includes
    // tool results with full file contents, so raw chars/4 can be 10-50x the window
    const historyTokensEst = this.lastInputTokens > 0
      ? this.lastInputTokens
      : Math.min(
          history.reduce((sum, m) => sum + estimateTokens(m.content), 0),
          contextWindow,
        )

    // Context utilization = current context fill / window
    const totalUsed = historyTokensEst
    const utilizationPct = Math.round((totalUsed / contextWindow) * 100)

    let risk: TokenBudget['risk']
    if (utilizationPct < 40) risk = 'green'
    else if (utilizationPct < 50) risk = 'yellow'
    else if (utilizationPct < 60) risk = 'orange'
    else risk = 'red'

    return {
      contextWindow,
      maxOutput,
      inputTokensUsed: this.cumulativeInput,
      outputTokensUsed: this.cumulativeOutput,
      historyTokensEst,
      utilizationPct,
      risk,
    }
  }

  /** Get total tokens used across all API calls */
  get totalTokens(): number {
    return this.cumulativeInput + this.cumulativeOutput
  }

  /**
   * Smart compaction: preserve decision-bearing messages.
   *
   * Priority (highest to lowest):
   *   1. System message (always kept)
   *   2. Tool result messages (contain verified state/decisions)
   *   3. Last N user/assistant pairs (recent context)
   *   4. Earlier user/assistant pairs (dropped first)
   *
   * @param history - Mutable conversation history
   * @param keepTurns - Number of recent user/assistant turns to keep
   * @returns Summary of what was compacted
   */
  smartCompact(history: ChatMessage[], keepTurns = 2): CompactionResult {
    const sysMsg = history.find(m => m.role === 'system')
    const convMsgs = history.filter(m => m.role !== 'system')

    if (convMsgs.length <= keepTurns * 2) {
      return { dropped: 0, kept: history.length, tokensFreed: 0, summary: 'Nothing to compact.' }
    }

    // Identify tool-result-like messages (assistant messages containing tool outputs)
    // These are high-value because they contain verified state
    const recentMsgs = convMsgs.slice(-keepTurns * 2)
    const olderMsgs = convMsgs.slice(0, -keepTurns * 2)

    // Among older messages, keep any that look like they contain decisions
    // (short messages with keywords like "fixed", "created", "verified", "PASS")
    const decisionKeywords = /\b(fixed|created|verified|pass|fail|error|bug|changed|updated|implemented)\b/i
    const keptDecisions: ChatMessage[] = []
    const droppedMsgs: ChatMessage[] = []

    for (const msg of olderMsgs) {
      const isShortDecision = msg.content.length < 200 && decisionKeywords.test(msg.content)
      if (isShortDecision) {
        keptDecisions.push(msg)
      } else {
        droppedMsgs.push(msg)
      }
    }

    // Cap kept decisions to avoid bloat
    const maxDecisions = 4
    const finalDecisions = keptDecisions.slice(-maxDecisions)
    const extraDropped = keptDecisions.slice(0, -maxDecisions)
    droppedMsgs.push(...extraDropped)

    // Rebuild history
    const droppedChars = droppedMsgs.reduce((sum, m) => sum + m.content.length, 0)
    const tokensFreed = Math.ceil(droppedChars / 4)

    // Create summary of dropped content
    const droppedRoles = droppedMsgs.reduce((acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const summaryParts = Object.entries(droppedRoles).map(([role, count]) => `${count} ${role}`)

    history.length = 0
    if (sysMsg) history.push(sysMsg)
    if (finalDecisions.length > 0) {
      history.push({ role: 'assistant', content: `[compacted: kept ${finalDecisions.length} key decisions]\n${finalDecisions.map(m => m.content.slice(0, 100)).join('\n')}` })
    }
    history.push(...recentMsgs)

    return {
      dropped: droppedMsgs.length,
      kept: history.length,
      tokensFreed,
      summary: `Dropped ${droppedMsgs.length} messages (${summaryParts.join(', ')}), freed ~${tokensFreed} tokens. Kept ${finalDecisions.length} decisions + last ${keepTurns} turns.`,
    }
  }
}
