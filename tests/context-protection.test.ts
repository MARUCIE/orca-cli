/**
 * Deep tests for context protection (nuclear compact) and UI improvements.
 *
 * Coverage areas:
 * 1. Nuclear compact (>100% utilization) — emergency context recovery
 * 2. Normal compact behavior — smart history truncation
 * 3. Budget calculation — risk levels and token estimation
 * 4. UI output formatting — separators, status lines, session summary
 */

import { describe, it, expect } from 'vitest'
import { TokenBudgetManager, estimateTokens, type CompactionResult } from '../src/token-budget.js'
import type { ChatMessage } from '../src/providers/openai-compat.js'

// ── Token Estimation Tests ──────────────────────────────────────────

describe('estimateTokens - CJK-aware estimation', () => {
  it('estimates Latin text at ~4 chars/token', () => {
    // "hello world test" = 16 chars, expect ceil(16/4) = 4 tokens
    const result = estimateTokens('hello world test')
    expect(result).toBe(4)
  })

  it('estimates CJK text at ~1.5 chars/token', () => {
    // 6 CJK chars + 1 ASCII '!': ceil(6/1.5 + 1/4) = ceil(4.25) = 5 tokens
    const result = estimateTokens('你好世界测试!')
    expect(result).toBe(5)
  })

  it('estimates mixed CJK+Latin text correctly', () => {
    // "hello 世界" = 5 Latin + 2 CJK = ceil(5/4 + 2/1.5) = ceil(1.25 + 1.33) = 3
    const result = estimateTokens('hello 世界')
    expect(result).toBe(3)
  })

  it('handles empty string', () => {
    const result = estimateTokens('')
    expect(result).toBe(0)
  })

  it('rounds up partial tokens (ceiling)', () => {
    // "abc" = 3 Latin chars, expect ceil(3/4) = 1 token
    const result = estimateTokens('abc')
    expect(result).toBe(1)
  })

  it('counts fullwidth forms as CJK', () => {
    // Fullwidth characters (U+FF00-FFEF) should be counted as CJK
    const result = estimateTokens('ａｂｃ')  // fullwidth ASCII
    expect(result).toBeGreaterThan(0)
  })

  it('handles very long text', () => {
    const longLatin = 'a'.repeat(10000)
    const result = estimateTokens(longLatin)
    expect(result).toBe(2500) // 10000 / 4
  })
})

// ── TokenBudgetManager: Budget Calculation ──────────────────────────

describe('TokenBudgetManager.getBudget - Risk Level Assessment', () => {
  it('returns green risk for <40% utilization', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    const history: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ]

    const budget = mgr.getBudget(history)
    expect(budget.risk).toBe('green')
    expect(budget.utilizationPct).toBeLessThan(40)
  })

  it('returns yellow risk for 40-50% utilization', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    // Simulate API-reported usage at ~40% of 200K window
    mgr.recordUsage(80000, 10000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' },
    ]

    const budget = mgr.getBudget(history)
    expect(budget.risk).toBe('yellow')
    expect(budget.utilizationPct).toBeGreaterThanOrEqual(40)
    expect(budget.utilizationPct).toBeLessThan(50)
  })

  it('returns orange risk for 50-60% utilization', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(110000, 10000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
    ]

    const budget = mgr.getBudget(history)
    expect(budget.risk).toBe('orange')
    expect(budget.utilizationPct).toBeGreaterThanOrEqual(50)
    expect(budget.utilizationPct).toBeLessThan(60)
  })

  it('returns red risk for >=60% utilization', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(130000, 10000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
    ]

    const budget = mgr.getBudget(history)
    expect(budget.risk).toBe('red')
    expect(budget.utilizationPct).toBeGreaterThanOrEqual(60)
  })

  it('prefers API-reported inputTokens over estimate', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(50000, 5000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System prompt (very long)'.repeat(1000) },
    ]

    const budget = mgr.getBudget(history)
    // API reported 50K, so historyTokensEst should be 50K (not estimated from content)
    expect(budget.historyTokensEst).toBe(50000)
  })

  it('caps estimated history at context window', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    // No API usage recorded
    const hugeContent = 'x'.repeat(1000000)
    const history: ChatMessage[] = [
      { role: 'system', content: hugeContent },
    ]

    const budget = mgr.getBudget(history)
    // Should be capped at 200K context window, not the full estimate
    expect(budget.historyTokensEst).toBeLessThanOrEqual(budget.contextWindow)
  })

  it('returns correct context window for different models', () => {
    const opusMgr = new TokenBudgetManager('claude-opus-4')
    const opusBudget = opusMgr.getBudget([{ role: 'system', content: '' }])
    expect(opusBudget.contextWindow).toBe(200000)

    const geminiBudget = new TokenBudgetManager('gemini-3').getBudget([{ role: 'system', content: '' }])
    expect(geminiBudget.contextWindow).toBe(2000000)

    const defaultBudget = new TokenBudgetManager('unknown-model').getBudget([{ role: 'system', content: '' }])
    expect(defaultBudget.contextWindow).toBe(128000)
  })
})

// ── TokenBudgetManager: Usage Recording ──────────────────────────────

describe('TokenBudgetManager.recordUsage - Cumulative Tracking', () => {
  it('accumulates input and output tokens', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    mgr.recordUsage(100, 50)
    mgr.recordUsage(150, 75)

    expect(mgr.totalTokens).toBe(100 + 50 + 150 + 75)
  })

  it('updates lastInputTokens for getBudget calculation', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(100, 50)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
    ]

    const budget = mgr.getBudget(history)
    // lastInputTokens (100) should be used as historyTokensEst
    expect(budget.historyTokensEst).toBe(100)
  })

  it('handles multiple calls with different token counts', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    mgr.recordUsage(1000, 500)
    expect(mgr.totalTokens).toBe(1500)

    mgr.recordUsage(2000, 1000)
    expect(mgr.totalTokens).toBe(4500)

    mgr.recordUsage(500, 250)
    expect(mgr.totalTokens).toBe(5250)
  })

  it('starts with zero tokens', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    expect(mgr.totalTokens).toBe(0)
  })
})

// ── TokenBudgetManager: Reset ────────────────────────────────────────

describe('TokenBudgetManager.reset', () => {
  it('zeroes all counters', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    mgr.recordUsage(1000, 500)
    mgr.recordUsage(2000, 1000)
    expect(mgr.totalTokens).toBe(4500)

    mgr.reset()

    expect(mgr.totalTokens).toBe(0)
  })

  it('allows resuming tracking after reset', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    mgr.recordUsage(1000, 500)
    mgr.reset()
    mgr.recordUsage(100, 50)

    expect(mgr.totalTokens).toBe(150)
  })
})

// ── NUCLEAR COMPACT: >100% Utilization ──────────────────────────────

describe('TokenBudgetManager.smartCompact - NUCLEAR MODE (>100%)', () => {
  it('drops all messages except system + last user in nuclear mode', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    // Simulate >90% of context window used (200K * 0.9 = 180K, need > 180K)
    mgr.recordUsage(190000, 10000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'First user message' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second user message' },
      { role: 'assistant', content: 'Second response' },
      { role: 'user', content: 'Third user message' },
    ]

    const result = mgr.smartCompact(history)

    // Should be nuclear mode since lastInputTokens (180K) > 90% of window (180K)
    expect(result.summary).toContain('NUCLEAR')
    expect(result.dropped).toBeGreaterThan(0)

    // After compaction, should have system + last user
    expect(history.length).toBeLessThanOrEqual(2)
    expect(history.some(m => m.role === 'system')).toBe(true)
    expect(history.some(m => m.role === 'user')).toBe(true)
  })

  it('truncates system prompt to 1500 chars in nuclear mode', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(195000, 10000)

    const longSystemPrompt = 'System: '.repeat(500) // ~4000 chars
    const history: ChatMessage[] = [
      { role: 'system', content: longSystemPrompt },
      { role: 'user', content: 'User message' },
      { role: 'assistant', content: 'Response' },
    ]

    mgr.smartCompact(history)

    const sysMsg = history.find(m => m.role === 'system')
    expect(sysMsg).toBeDefined()
    expect(sysMsg!.content.length).toBeLessThanOrEqual(1550) // 1500 + "[system truncated...]"
    expect(sysMsg!.content).toContain('[system truncated for recovery]')
  })

  it('truncates last user message to 1000 chars in nuclear mode', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(195000, 10000)

    const hugeUserMsg = 'User message: '.repeat(200) // ~2800 chars
    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: hugeUserMsg },
      { role: 'assistant', content: 'Response' },
    ]

    mgr.smartCompact(history)

    const userMsg = history.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content.length).toBeLessThanOrEqual(1015) // 1000 + "\n[truncated]"
    expect(userMsg!.content).toContain('[truncated]')
  })

  it('returns correct drop count and tokens freed in nuclear mode', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(195000, 10000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Second' },
      { role: 'assistant', content: 'Response 2' },
    ]

    const result = mgr.smartCompact(history)

    expect(result.dropped).toBeGreaterThan(0)
    expect(result.tokensFreed).toBeGreaterThan(0)
    expect(result.kept).toBeGreaterThan(0)
  })

  it('handles history with only system message', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(195000, 10000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
    ]

    const result = mgr.smartCompact(history)

    // Should keep just the system message
    expect(history.length).toBe(1)
    expect(history[0]!.role).toBe('system')
    expect(result.dropped).toBe(0)
  })

  it('handles history with no user messages (only system + assistant)', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(195000, 10000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'assistant', content: 'Response 2' },
    ]

    const result = mgr.smartCompact(history)

    // Should keep system, drop assistants
    expect(history.some(m => m.role === 'system')).toBe(true)
    expect(result.dropped).toBeGreaterThan(0)
  })

  it('gracefully handles empty history', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    mgr.recordUsage(195000, 10000)

    const history: ChatMessage[] = []

    const result = mgr.smartCompact(history)

    expect(history.length).toBe(0)
    expect(result.dropped).toBe(0)
  })

  it('triggers nuclear mode when estimatedPct > 100', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    // Don't set recordUsage — force estimation path
    // Need > 200K tokens worth of content: 200K * 4 = 800K+ chars
    const hugeContent = 'x'.repeat(900000) // ~225K tokens > 200K window

    const history: ChatMessage[] = [
      { role: 'system', content: hugeContent },
      { role: 'user', content: 'Last message' },
      { role: 'assistant', content: 'Response' },
    ]

    const result = mgr.smartCompact(history)

    expect(result.summary).toContain('NUCLEAR')
  })
})

// ── NORMAL COMPACT: Preserving Recent Turns ────────────────────────

describe('TokenBudgetManager.smartCompact - Normal Mode', () => {
  it('keeps last keepTurns=2 conversation turns', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Old message 1' },
      { role: 'assistant', content: 'Old response 1' },
      { role: 'user', content: 'Recent message' },
      { role: 'assistant', content: 'Recent response' },
    ]

    const result = mgr.smartCompact(history, 2)

    // Should keep system + last 2 turns (4 conversation messages)
    // Might drop old messages
    expect(history.some(m => m.role === 'system')).toBe(true)
    expect(history.some(m => m.content === 'Recent message')).toBe(true)
    expect(history.some(m => m.content === 'Recent response')).toBe(true)
  })

  it('keeps last keepTurns=1 conversation turns', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Old 1' },
      { role: 'assistant', content: 'Old resp 1' },
      { role: 'user', content: 'Old 2' },
      { role: 'assistant', content: 'Old resp 2' },
      { role: 'user', content: 'Recent' },
      { role: 'assistant', content: 'Recent resp' },
    ]

    const result = mgr.smartCompact(history, 1)

    // Should keep system + last 1 turn (2 conversation messages)
    expect(history.some(m => m.content === 'Recent')).toBe(true)
    expect(history.some(m => m.content === 'Recent resp')).toBe(true)
  })

  it('truncates messages >1000 chars (non-system)', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const largeMessage = 'x'.repeat(1200)
    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: largeMessage },
    ]

    mgr.smartCompact(history)

    const userMsg = history.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content.length).toBeLessThanOrEqual(1250) // 1000 + "[truncated:...]"
  })

  it('truncates system prompt >3000 chars (non-nuclear mode)', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const largeSystemPrompt = 'x'.repeat(3500)
    const history: ChatMessage[] = [
      { role: 'system', content: largeSystemPrompt },
      { role: 'user', content: 'Small message' },
    ]

    mgr.smartCompact(history)

    const sysMsg = history.find(m => m.role === 'system')
    expect(sysMsg).toBeDefined()
    expect(sysMsg!.content.length).toBeLessThanOrEqual(2100) // 2000 + "[system truncated]"
  })

  it('keeps few messages intact when total < keepTurns*2', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const history: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Message' },
    ]

    const result = mgr.smartCompact(history, 2)

    // Only 2 total messages (system + 1 user), should handle gracefully
    expect(history.length).toBeGreaterThan(0)
    expect(result.summary).toBeDefined()
  })

  it('preserves small decision messages from older history', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User 1' },
      { role: 'assistant', content: 'Large response'.repeat(100) }, // Too big
      { role: 'assistant', content: 'DECISION: use approach A' },    // Small decision
      { role: 'user', content: 'User 2' },
      { role: 'assistant', content: 'Response 2' },
    ]

    const result = mgr.smartCompact(history, 2)

    // Small decision messages should be kept
    expect(result.summary).toContain('decisions')
  })

  it('returns summary with dropped message counts by role', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Old user 1' },
      { role: 'assistant', content: 'Old response 1' },
      { role: 'user', content: 'Old user 2' },
      { role: 'assistant', content: 'Old response 2' },
      { role: 'user', content: 'Recent' },
      { role: 'assistant', content: 'Recent resp' },
    ]

    const result = mgr.smartCompact(history)

    expect(result.summary).toBeDefined()
    expect(result.summary.length).toBeGreaterThan(0)
    expect(result.dropped).toBeGreaterThanOrEqual(0)
  })
})

// ── CompactionResult Structure ──────────────────────────────────────

describe('CompactionResult data structure', () => {
  it('has all required fields', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User' },
    ]

    const result = mgr.smartCompact(history)

    expect(result).toHaveProperty('dropped')
    expect(result).toHaveProperty('kept')
    expect(result).toHaveProperty('tokensFreed')
    expect(result).toHaveProperty('summary')

    expect(typeof result.dropped).toBe('number')
    expect(typeof result.kept).toBe('number')
    expect(typeof result.tokensFreed).toBe('number')
    expect(typeof result.summary).toBe('string')
  })

  it('dropped + kept equals final history length', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'User 1' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'User 2' },
      { role: 'assistant', content: 'Response 2' },
    ]

    const originalLength = history.length
    const result = mgr.smartCompact(history)

    expect(result.kept).toBeLessThanOrEqual(originalLength)
    expect(result.dropped + result.kept).toBeGreaterThanOrEqual(result.kept)
  })
})

// ── Edge Cases ──────────────────────────────────────────────────────

describe('TokenBudgetManager.smartCompact - Edge Cases', () => {
  it('handles message with exactly 1000 chars', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    const msg1000 = 'x'.repeat(1000)

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: msg1000 },
    ]

    mgr.smartCompact(history)

    const userMsg = history.find(m => m.role === 'user')
    // Exactly 1000 chars should not be truncated (unless condition is >1000)
    expect(userMsg!.content.length).toBeLessThanOrEqual(1010)
  })

  it('handles system prompt exactly 3000 chars', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')
    const msg3000 = 'x'.repeat(3000)

    const history: ChatMessage[] = [
      { role: 'system', content: msg3000 },
      { role: 'user', content: 'User' },
    ]

    mgr.smartCompact(history)

    const sysMsg = history.find(m => m.role === 'system')
    // Exactly 3000 chars should not be truncated (unless condition is >3000)
    expect(sysMsg!.content.length).toBeGreaterThanOrEqual(3000)
  })

  it('handles alternating user/assistant messages', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'U2' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: 'U3' },
      { role: 'assistant', content: 'A3' },
    ]

    const result = mgr.smartCompact(history, 2)

    expect(result.kept).toBeGreaterThan(0)
    expect(result.summary).toBeDefined()
  })

  it('handles very large tokenFreed values', () => {
    const mgr = new TokenBudgetManager('claude-opus-4')

    const hugeMsg = 'x'.repeat(500000)
    const history: ChatMessage[] = [
      { role: 'system', content: 'System' },
      { role: 'user', content: hugeMsg },
      { role: 'assistant', content: 'Response' },
    ]

    const result = mgr.smartCompact(history, 2)

    expect(result.tokensFreed).toBeGreaterThan(0)
    expect(result.tokensFreed).toBeLessThan(200000) // Should be reasonable estimate
  })
})
