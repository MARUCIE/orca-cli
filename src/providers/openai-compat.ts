/**
 * OpenAI-compatible provider for proxy services (Poe, OpenRouter, etc.)
 *
 * Uses the OpenAI SDK to talk to any OpenAI-compatible endpoint.
 * This is used when the orca CLI targets a proxy provider that speaks
 * OpenAI protocol but serves multiple model families (Claude, GPT, Gemini).
 */

import { execSync } from 'node:child_process'

import { logWarning } from '../logger.js'

export interface OpenAICompatOptions {
  apiKey: string
  baseURL: string
  model: string
  systemPrompt?: string
  maxTokens?: number
}

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'usage' | 'done' | 'error'
  text?: string
  toolName?: string
  toolInput?: string
  toolOutput?: string
  toolSuccess?: boolean
  inputTokens?: number
  outputTokens?: number
  error?: string
}

export interface ToolCallbacks {
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; output: string }> | { success: boolean; output: string }
  abortSignal?: AbortSignal
}

/**
 * Stream a chat completion from an OpenAI-compatible endpoint.
 * Yields StreamEvent objects for the CLI to render.
 */
/**
 * Resolve HTTP proxy from environment, with macOS system proxy fallback.
 *
 * Resolution order:
 *   1. HTTPS_PROXY / HTTP_PROXY / ALL_PROXY env vars
 *   2. macOS system proxy via `scutil --proxy` (Surge, Clash, Shadowrocket etc.)
 */
let _cachedSystemProxy: string | undefined | null = null // null = not checked yet

function detectMacOSSystemProxy(): string | undefined {
  if (process.platform !== 'darwin') return undefined
  try {
    const output = execSync('scutil --proxy 2>/dev/null', { encoding: 'utf-8', timeout: 2000 })
    // Check HTTPS proxy first, then HTTP
    const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(output)
    if (httpsEnabled) {
      const hostMatch = output.match(/HTTPSProxy\s*:\s*(\S+)/)
      const portMatch = output.match(/HTTPSPort\s*:\s*(\d+)/)
      if (hostMatch && portMatch) {
        return `http://${hostMatch[1]}:${portMatch[1]}`
      }
    }
    const httpEnabled = /HTTPEnable\s*:\s*1/.test(output)
    if (httpEnabled) {
      const hostMatch = output.match(/HTTPProxy\s*:\s*(\S+)/)
      const portMatch = output.match(/HTTPPort\s*:\s*(\d+)/)
      if (hostMatch && portMatch) {
        return `http://${hostMatch[1]}:${portMatch[1]}`
      }
    }
  } catch { /* scutil not available or timed out */ }
  return undefined
}

function resolveProxy(): string | undefined {
  // Environment variables take priority
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY
  if (envProxy) return envProxy

  // Fallback: macOS system proxy (cached after first check)
  if (_cachedSystemProxy === null) {
    _cachedSystemProxy = detectMacOSSystemProxy()
  }
  return _cachedSystemProxy
}

/**
 * Model max output tokens — keyed by lowercase prefix match.
 * When the model isn't recognized, fall back to 16384 (safe for all major providers).
 */
const MODEL_MAX_OUTPUT: Array<[string, number]> = [
  // Anthropic
  ['claude-opus-4',     32000],
  ['claude-sonnet-4',   64000],
  // OpenAI
  ['gpt-5',             64000],
  // Google
  ['gemini-3',          65536],
  // Open-source / China
  ['gemma-4',           8192],
  ['glm-5',             8192],
  ['grok-4',            32000],
  ['qwen3',             32000],
  ['kimi-k2',           32000],
  ['minimax-m2',        16384],
]

function getModelMaxOutput(model: string): number {
  const lower = model.toLowerCase()
  for (const [prefix, max] of MODEL_MAX_OUTPUT) {
    if (lower.includes(prefix)) return max
  }
  return 16384 // safe fallback
}

const MODEL_CONTEXT_WINDOW: Array<[string, number]> = [
  ['claude-opus', 200_000],
  ['claude-sonnet', 200_000],
  ['gpt-5', 256_000],
  ['gpt-4.1', 1_000_000],
  ['gpt-4o', 128_000],
  ['gemini-3', 2_000_000],
  ['gemini-2', 1_000_000],
  ['gemma', 128_000],
  ['grok', 256_000],
  ['qwen', 128_000],
  ['kimi', 256_000],
]

function getModelContextWindow(model: string): number {
  const lower = model.toLowerCase()
  for (const [prefix, window] of MODEL_CONTEXT_WINDOW) {
    if (lower.includes(prefix)) return window
  }
  return 128_000 // safe fallback
}

let proxyWarningShown = false

async function createOpenAIClient(apiKey: string, baseURL: string) {
  const { default: OpenAI } = await import('openai')

  const proxyUrl = resolveProxy()
  if (proxyUrl) {
    if (!proxyWarningShown && proxyUrl.startsWith('http://') && baseURL.startsWith('https://')) {
      console.error('\x1b[33m  warn: using HTTP proxy for HTTPS traffic\x1b[0m')
      logWarning('using HTTP proxy for HTTPS traffic', { proxyUrl, baseURL })
      proxyWarningShown = true
    }
    // OpenAI SDK v6 uses native fetch; we override with proxy-aware fetch
    const { ProxyAgent, fetch: undiciFetch } = await import('undici')
    const dispatcher = new ProxyAgent(proxyUrl)
    const proxyFetch = (url: string | URL | Request, init?: RequestInit) =>
      undiciFetch(url as string, { ...(init as Record<string, unknown>), dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>
    return new OpenAI({ apiKey, baseURL, fetch: proxyFetch, maxRetries: 0 })
  }

  return new OpenAI({ apiKey, baseURL, maxRetries: 0 })
}

/**
 * Retry wrapper for 429 rate limit errors.
 * Retries up to 3 times with exponential backoff (2s, 4s, 8s).
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const is429 = message.includes('429') || message.includes('rate')
      if (!is429 || attempt === MAX_RETRIES) throw err

      const delay = Math.pow(2, attempt + 1) * 1000 // 2s, 4s, 8s
      console.error(`\x1b[33m  rate limited${label ? ` (${label})` : ''} — retrying in ${delay / 1000}s (${attempt + 1}/${MAX_RETRIES})\x1b[0m`)
      logWarning('rate limited, retrying', { label, attempt: attempt + 1, delayMs: delay })
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}

/**
 * Stream a chat completion from an OpenAI-compatible endpoint.
 * Yields StreamEvent objects for the CLI to render.
 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export async function* streamChat(
  options: OpenAICompatOptions,
  prompt: string,
  history?: ChatMessage[],
  toolCallbacks?: ToolCallbacks,
  tools?: Array<Record<string, unknown>>,
): AsyncGenerator<StreamEvent> {
  const client = await createOpenAIClient(options.apiKey, options.baseURL)

  // Build message array with history
  const messages: Array<Record<string, unknown>> = []

  if (options.systemPrompt && (!history || history.length === 0)) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  if (history) {
    for (const m of history) {
      messages.push({ role: m.role, content: m.content })
    }
  }
  messages.push({ role: 'user', content: prompt })

  let totalInputTokens = 0
  let totalOutputTokens = 0

  // Context window for budget checks (conservative estimate)
  const modelContextWindow = getModelContextWindow(options.model)
  const MAX_TOOL_RESULT_CHARS = 4000 // truncate individual tool results beyond this

  try {
    for (let round = 0; /* no limit — loop until task completes, error, or abort */ ; round++) {
      // Check abort signal between rounds
      if (toolCallbacks?.abortSignal?.aborted) {
        yield { type: 'text', text: '\n\n[interrupted]' }
        yield { type: 'done' }
        return
      }

      // Pre-round context budget check: estimate messages size and truncate if needed
      // This prevents 413 errors by ensuring we never send more than the context window
      const estimatedChars = messages.reduce((sum, m) => {
        const c = m.content as string | null | undefined
        return sum + (typeof c === 'string' ? c.length : 0)
      }, 0)
      const estimatedTokens = Math.ceil(estimatedChars / 3) // conservative estimate
      if (estimatedTokens > modelContextWindow * 0.75) {
        // Truncate oldest tool results to free space (keep system + last 4 messages)
        const keepCount = 4
        let freed = 0
        for (let i = 1; i < messages.length - keepCount; i++) {
          const msg = messages[i]!
          const content = msg.content as string | null
          if ((msg.role === 'tool' || msg.role === 'assistant') && typeof content === 'string' && content.length > 200) {
            const oldLen = content.length
            msg.content = content.slice(0, 150) + `\n[truncated: ${Math.ceil(oldLen / 3)} tokens freed for context budget]`
            freed += oldLen - (msg.content as string).length
          }
        }
        if (freed > 0) {
          yield { type: 'text', text: `\n[context-guard: truncated ${Math.ceil(freed / 3)} tokens from older messages]\n` }
        }
      }

      // Build request params
      const params: Record<string, unknown> = {
        model: options.model,
        messages,
        stream: true,
        max_tokens: options.maxTokens || getModelMaxOutput(options.model),
      }

      // Include tools if available (function calling)
      if (tools && tools.length > 0 && toolCallbacks?.onToolCall) {
        params.tools = tools
      }

      // Force stream=true typing with unknown cast (params built dynamically for tool support)
      const response = await withRateLimitRetry(
        () => client.chat.completions.create(params as unknown as Parameters<typeof client.chat.completions.create>[0]),
        options.model,
      )
      const stream = response as AsyncIterable<Record<string, unknown>>

      let textContent = ''
      const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
      let finishReason = ''

      for await (const rawChunk of stream) {
        const chunk = rawChunk as Record<string, unknown>
        const choices = chunk.choices as Array<Record<string, unknown>> | undefined
        const choice = choices?.[0]
        if (!choice) continue

        const delta = choice.delta as Record<string, unknown> | undefined
        if (!delta) continue

        // Text content
        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'text', text: delta.content }
          textContent += delta.content
        }

        // Tool call deltas (streamed incrementally)
        const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
        if (deltaToolCalls) {
          for (const tc of deltaToolCalls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0
            if (!toolCalls[idx]) {
              toolCalls[idx] = {
                id: (tc.id as string) || `call_${idx}`,
                name: (tc.function as Record<string, unknown>)?.name as string || '',
                arguments: '',
              }
            }
            const fnArgs = (tc.function as Record<string, unknown>)?.arguments as string | undefined
            if (fnArgs) {
              toolCalls[idx]!.arguments += fnArgs
            }
          }
        }

        // Usage info
        const usage = chunk.usage as Record<string, number> | undefined
        if (usage) {
          totalInputTokens += usage.prompt_tokens || 0
          totalOutputTokens += usage.completion_tokens || 0
        }

        if (choice.finish_reason) {
          finishReason = String(choice.finish_reason)
        }
      }

      // If model wants to call tools
      if (finishReason === 'tool_calls' && toolCalls.length > 0 && toolCallbacks?.onToolCall) {
        // Add assistant message with tool calls to conversation
        messages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        })

        // Execute each tool and add results
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.arguments) } catch { /* use empty */ }

          yield { type: 'tool_use', toolName: tc.name, toolInput: tc.arguments }

          const result = await toolCallbacks.onToolCall(tc.name, args)
          yield { type: 'tool_result', toolName: tc.name, toolSuccess: result.success, toolOutput: result.output }

          // Truncate large tool results to prevent context explosion
          // A single read_file of 300 lines = ~12K chars = ~3K tokens
          // 6 such reads = 72K chars = 18K tokens → easily overflows 200K window
          let toolContent = result.output
          if (toolContent.length > MAX_TOOL_RESULT_CHARS) {
            const lines = toolContent.split('\n')
            const headLines = Math.min(40, Math.floor(lines.length / 2))
            const tailLines = Math.min(20, Math.floor(lines.length / 4))
            toolContent = lines.slice(0, headLines).join('\n')
              + `\n\n[... ${lines.length - headLines - tailLines} lines truncated for context budget ...]\n\n`
              + lines.slice(-tailLines).join('\n')
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolContent,
          })
        }

        // Continue the loop — model will process tool results
        continue
      }

      // Handle terminated — provider cut the response (e.g., Poe API timeout, proxy disconnect)
      if (finishReason === 'terminated' || finishReason === 'error') {
        if (round < 3) { // max 3 auto-retries for terminated responses
          messages.push({ role: 'assistant', content: textContent || '' })
          messages.push({ role: 'user', content: 'The response was terminated prematurely. Continue from where you left off and complete the task.' })
          yield { type: 'text', text: `\n[response terminated, retrying (${round + 1}/3)...]\n` }
          continue
        }
        // Exhausted retries — yield what we have and stop
        yield { type: 'text', text: '\n[response terminated after 3 retries]\n' }
        yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
        yield { type: 'done' }
        return
      }

      // Handle model hitting max_tokens — auto-continue
      if (finishReason === 'length') {
        messages.push({ role: 'assistant', content: textContent || '' })
        messages.push({ role: 'user', content: 'Continue from where you left off. Complete the task.' })
        yield { type: 'text', text: '\n[continuing...]\n' }
        continue
      }

      // Handle model stopping mid-task: if previous rounds had tool calls but
      // this final round has none, and text looks incomplete, auto-continue once
      if (finishReason === 'stop' && round > 0 && toolCalls.length === 0 && textContent) {
        const trimmed = textContent.trimEnd()
        const looksIncomplete = /[：:，,]$/.test(trimmed) ||
          /(?:现在|接下来|下面|I'll|Let me|I will|Now I|Here's|Let's)\s*\S*$/i.test(trimmed)
        if (looksIncomplete) {
          messages.push({ role: 'assistant', content: textContent })
          messages.push({ role: 'user', content: 'Continue. Execute the remaining steps to complete the task.' })
          yield { type: 'text', text: '\n[auto-continuing task...]\n' }
          continue
        }
      }

      // No more tool calls and task appears complete — we're done
      yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
      yield { type: 'done' }
      break
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    yield { type: 'error', error: message }
    // Still yield usage so the caller can track what was consumed
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
    }
  }
}

/**
 * One-shot chat completion (non-streaming) for quick tests.
 */
export async function chatOnce(
  options: OpenAICompatOptions,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = await createOpenAIClient(options.apiKey, options.baseURL)

  const messages: Array<{ role: 'system' | 'user'; content: string }> = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await withRateLimitRetry(
    () => client.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: options.maxTokens || getModelMaxOutput(options.model),
    }, signal ? { signal } : undefined),
    options.model,
  )

  const choice = response.choices?.[0]
  return {
    text: choice?.message?.content || '',
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
  }
}
