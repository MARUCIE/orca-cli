/**
 * OpenAI-compatible provider for proxy services (Poe, OpenRouter, etc.)
 *
 * Uses the OpenAI SDK to talk to any OpenAI-compatible endpoint.
 * This is used when the forge CLI targets a proxy provider that speaks
 * OpenAI protocol but serves multiple model families (Claude, GPT, Gemini).
 */

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
  onToolCall?: (name: string, args: Record<string, unknown>) => { success: boolean; output: string }
  abortSignal?: AbortSignal
}

/**
 * Stream a chat completion from an OpenAI-compatible endpoint.
 * Yields StreamEvent objects for the CLI to render.
 */
/**
 * Resolve HTTP proxy from environment.
 * macOS system proxy (Surge/Shadowrocket) detected via scutil, but
 * we rely on users setting HTTPS_PROXY or the CLI auto-detecting it.
 */
function resolveProxy(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    undefined
  )
}

let proxyWarningShown = false

async function createOpenAIClient(apiKey: string, baseURL: string) {
  const { default: OpenAI } = await import('openai')

  const proxyUrl = resolveProxy()
  if (proxyUrl) {
    if (!proxyWarningShown && proxyUrl.startsWith('http://') && baseURL.startsWith('https://')) {
      console.error('\x1b[33m  warn: using HTTP proxy for HTTPS traffic\x1b[0m')
      proxyWarningShown = true
    }
    // OpenAI SDK v6 uses native fetch; we override with proxy-aware fetch
    const { ProxyAgent, fetch: undiciFetch } = await import('undici')
    const dispatcher = new ProxyAgent(proxyUrl)
    const proxyFetch = (url: string | URL | Request, init?: RequestInit) =>
      undiciFetch(url as string, { ...(init as Record<string, unknown>), dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>
    return new OpenAI({ apiKey, baseURL, fetch: proxyFetch })
  }

  return new OpenAI({ apiKey, baseURL })
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
  const maxToolRounds = 8 // prevent runaway tool loops

  try {
    for (let round = 0; round <= maxToolRounds; round++) {
      // Check abort signal between rounds
      if (toolCallbacks?.abortSignal?.aborted) {
        yield { type: 'text', text: '\n\n[interrupted]' }
        yield { type: 'done' }
        return
      }
      // Build request params
      const params: Record<string, unknown> = {
        model: options.model,
        messages,
        stream: true,
        max_tokens: options.maxTokens || 4096,
      }

      // Include tools if available (function calling)
      if (tools && tools.length > 0 && toolCallbacks?.onToolCall) {
        params.tools = tools
      }

      // Force stream=true typing with unknown cast (params built dynamically for tool support)
      const response = await client.chat.completions.create(params as unknown as Parameters<typeof client.chat.completions.create>[0])
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

          const result = toolCallbacks.onToolCall(tc.name, args)
          yield { type: 'tool_result', toolName: tc.name, toolSuccess: result.success, toolOutput: result.output }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.output,
          })
        }

        // Continue the loop — model will process tool results
        continue
      }

      // No more tool calls — we're done
      yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
      yield { type: 'done' }
      break
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    yield { type: 'error', error: message }
  }
}

/**
 * One-shot chat completion (non-streaming) for quick tests.
 */
export async function chatOnce(
  options: OpenAICompatOptions,
  prompt: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = await createOpenAIClient(options.apiKey, options.baseURL)

  const messages: Array<{ role: 'system' | 'user'; content: string }> = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await client.chat.completions.create({
    model: options.model,
    messages,
    max_tokens: options.maxTokens || 4096,
  })

  const choice = response.choices?.[0]
  return {
    text: choice?.message?.content || '',
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
  }
}
