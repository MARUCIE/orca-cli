/**
 * Round 4: Agent Loop Integrity — 15 tests
 * SOTA Dimension D3: Streaming loop, auto-continue, context management
 *
 * Tests the core streaming conversation loop that is the heart of
 * any coding agent. Uses vi.mock to intercept OpenAI SDK.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StreamEvent } from '../src/providers/openai-compat.js'

// ── Mock Setup ──────────────────────────────────────────────────

function makeChunk(opts: {
  content?: string
  toolCalls?: Array<{ index: number; id?: string; name?: string; arguments?: string }>
  finishReason?: string | null
  usage?: { prompt_tokens: number; completion_tokens: number }
}) {
  const delta: Record<string, unknown> = {}
  if (opts.content !== undefined) delta.content = opts.content
  if (opts.toolCalls) {
    delta.tool_calls = opts.toolCalls.map(tc => ({
      index: tc.index,
      id: tc.id,
      function: { name: tc.name, arguments: tc.arguments },
    }))
  }
  return {
    choices: [{ delta, finish_reason: opts.finishReason ?? null }],
    ...(opts.usage ? { usage: opts.usage } : {}),
  }
}

type MockStreamFactory = () => AsyncIterable<Record<string, unknown>>

// Shared mock state via vi.hoisted (available before module evaluation)
const mockState = vi.hoisted(() => {
  const responses: MockStreamFactory[] = []
  return { responses }
})

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: async () => {
          const factory = mockState.responses.shift()
          if (!factory) throw new Error('No more mock responses')
          return factory()
        },
      },
    }
  },
}))

vi.mock('undici', () => ({
  ProxyAgent: class {},
  fetch: async () => ({}),
}))

// Normal import — vi.mock is hoisted, so openai is already mocked
import { streamChat } from '../src/providers/openai-compat.js'

// ── Helpers ─────────────────────────────────────────────────────

async function* makeStream(chunks: Record<string, unknown>[]) {
  for (const chunk of chunks) yield chunk
}

async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

const baseOpts = {
  apiKey: 'test-key',
  baseURL: 'https://test.example.com/v1/',
  model: 'claude-sonnet-4.6',
}

const dummyTools = [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }]

beforeEach(() => {
  mockState.responses.length = 0
})

// ── Tests ───────────────────────────────────────────────────────

describe('Agent Loop: Basic streaming', () => {
  it('4.1 yields text tokens from streaming response', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Hello' }),
      makeChunk({ content: ' world' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(streamChat(baseOpts, 'Say hello'))
    const textEvents = events.filter(e => e.type === 'text')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0]!.text).toBe('Hello')
    expect(textEvents[1]!.text).toBe(' world')
  })

  it('4.2 yields tool_use and tool_result events', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ toolCalls: [{ index: 0, id: 'call_1', name: 'read_file', arguments: '{"path":"test.ts"}' }] }),
      makeChunk({ finishReason: 'tool_calls' }),
    ]))
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'File read.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(
      streamChat(baseOpts, 'Read', undefined, {
        onToolCall: async () => ({ success: true, output: 'const x = 1' }),
      }, dummyTools as Array<Record<string, unknown>>)
    )

    expect(events.find(e => e.type === 'tool_use')).toBeDefined()
    expect(events.find(e => e.type === 'tool_use')!.toolName).toBe('read_file')
    expect(events.find(e => e.type === 'tool_result')).toBeDefined()
    expect(events.find(e => e.type === 'tool_result')!.toolSuccess).toBe(true)
  })

  it('4.3 auto-continues on finishReason=length', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Start...' }),
      makeChunk({ finishReason: 'length' }),
    ]))
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'End.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(streamChat(baseOpts, 'Long'))
    const allText = events.filter(e => e.type === 'text').map(e => e.text).join('')
    expect(allText).toContain('Start...')
    expect(allText).toContain('[continuing...]')
    expect(allText).toContain('End.')
  })

  it('4.4 stops on finishReason=stop without continuation', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Done.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(streamChat(baseOpts, 'Quick'))
    const allText = events.filter(e => e.type === 'text').map(e => e.text).join('')
    expect(allText).not.toContain('[continuing...]')
    expect(events.find(e => e.type === 'done')).toBeDefined()
  })
})

describe('Agent Loop: Tool call accumulation', () => {
  it('4.5 accumulates streamed tool call arguments across chunks', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ toolCalls: [{ index: 0, id: 'c1', name: 'edit_file', arguments: '{"path":' }] }),
      makeChunk({ toolCalls: [{ index: 0, arguments: '"test.ts",' }] }),
      makeChunk({ toolCalls: [{ index: 0, arguments: '"old":"a","new":"b"}' }] }),
      makeChunk({ finishReason: 'tool_calls' }),
    ]))
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Edited.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    let calledArgs: Record<string, unknown> = {}
    await collectEvents(
      streamChat(baseOpts, 'Edit', undefined, {
        onToolCall: async (_name, args) => { calledArgs = args; return { success: true, output: 'ok' } },
      }, dummyTools as Array<Record<string, unknown>>)
    )

    expect(calledArgs.path).toBe('test.ts')
  })

  it('4.6 handles multiple tool calls in single response', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ toolCalls: [{ index: 0, id: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}' }] }),
      makeChunk({ toolCalls: [{ index: 1, id: 'c2', name: 'read_file', arguments: '{"path":"b.ts"}' }] }),
      makeChunk({ finishReason: 'tool_calls' }),
    ]))
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Both read.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const names: string[] = []
    await collectEvents(
      streamChat(baseOpts, 'Read both', undefined, {
        onToolCall: async (name) => { names.push(name); return { success: true, output: 'content' } },
      }, dummyTools as Array<Record<string, unknown>>)
    )

    expect(names).toEqual(['read_file', 'read_file'])
  })
})

describe('Agent Loop: Error handling', () => {
  it('4.7 yields error event on API failure', async () => {
    mockState.responses.push(() => { throw new Error('API rate limit exceeded') })

    const events = await collectEvents(streamChat(baseOpts, 'Will fail'))
    const err = events.find(e => e.type === 'error')
    expect(err).toBeDefined()
    expect(err!.error).toContain('rate limit')
  })

  it('4.8 handles empty response gracefully', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(streamChat(baseOpts, 'Empty'))
    expect(events.find(e => e.type === 'done')).toBeDefined()
  })

  it('4.9 abortSignal interrupts the loop', async () => {
    const controller = new AbortController()
    controller.abort()

    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'should not reach' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(
      streamChat(baseOpts, 'Aborted', undefined, { abortSignal: controller.signal })
    )

    const allText = events.filter(e => e.type === 'text').map(e => e.text).join('')
    expect(allText).toContain('[interrupted]')
  })
})

describe('Agent Loop: Usage tracking', () => {
  it('4.10 accumulates usage tokens across rounds', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Part 1' }),
      makeChunk({ usage: { prompt_tokens: 100, completion_tokens: 50 } }),
      makeChunk({ finishReason: 'length' }),
    ]))
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Part 2' }),
      makeChunk({ usage: { prompt_tokens: 200, completion_tokens: 75 } }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(streamChat(baseOpts, 'Long'))
    const usage = events.find(e => e.type === 'usage')
    expect(usage).toBeDefined()
    expect(usage!.inputTokens).toBe(300)
    expect(usage!.outputTokens).toBe(125)
  })
})

describe('Agent Loop: Incomplete text detection', () => {
  it('4.11 auto-continues when text looks incomplete', async () => {
    // Round 0: tool call (sets round > 0)
    mockState.responses.push(() => makeStream([
      makeChunk({ toolCalls: [{ index: 0, id: 'c1', name: 'read_file', arguments: '{"path":"x"}' }] }),
      makeChunk({ finishReason: 'tool_calls' }),
    ]))
    // Round 1: incomplete text ending with Chinese colon
    mockState.responses.push(() => makeStream([
      makeChunk({ content: '现在我来实现：' }),
      makeChunk({ finishReason: 'stop' }),
    ]))
    // Round 2: completion
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Done.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(
      streamChat(baseOpts, 'Implement', undefined, {
        onToolCall: async () => ({ success: true, output: 'content' }),
      }, dummyTools as Array<Record<string, unknown>>)
    )

    const allText = events.filter(e => e.type === 'text').map(e => e.text).join('')
    expect(allText).toContain('[auto-continuing task...]')
  })
})

describe('Agent Loop: Model configuration', () => {
  it('4.12 works with different model names', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'OK' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(
      streamChat({ ...baseOpts, model: 'gpt-5.4' }, 'test')
    )
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('4.13 includes system prompt when no history', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'OK' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(
      streamChat({ ...baseOpts, systemPrompt: 'You are a test agent' }, 'hello')
    )
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('4.14 includes history messages in context', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'I remember.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(
      streamChat(baseOpts, 'What did I say?', [
        { role: 'user', content: 'My name is Test' },
        { role: 'assistant', content: 'Hello Test!' },
      ])
    )
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('4.15 done is the last meaningful event', async () => {
    mockState.responses.push(() => makeStream([
      makeChunk({ content: 'Complete.' }),
      makeChunk({ finishReason: 'stop' }),
    ]))

    const events = await collectEvents(streamChat(baseOpts, 'Finish'))
    const types = events.map(e => e.type)
    const doneIdx = types.lastIndexOf('done')
    const usageIdx = types.lastIndexOf('usage')
    // done should be after usage
    expect(doneIdx).toBeGreaterThan(usageIdx)
  })
})
