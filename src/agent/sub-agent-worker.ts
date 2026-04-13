/**
 * Sub-agent worker — runs in a forked child process.
 *
 * Receives a task via IPC, runs a full agentic loop with
 * restricted tools (streamChat handles tool-call cycling internally),
 * and sends the result back to the parent with progress updates.
 *
 * Safety: maxTurns guard prevents runaway loops.
 */

import { TOOL_DEFINITIONS, executeTool } from '../tools.js'
import { streamChat } from '../providers/openai-compat.js'
import type { ChatMessage } from '../providers/openai-compat.js'
import type { WorkerRequest, WorkerResponse } from './sub-agent.js'

function sendResult(result: Omit<WorkerResponse, 'type'>): void {
  if (process.send) {
    process.send({ type: 'result', ...result } satisfies WorkerResponse)
  }
}

function sendProgress(tokensUsed: number, toolCalls: number): void {
  if (process.send) {
    process.send({ type: 'progress', success: true, output: '', tokensUsed, toolCalls } satisfies WorkerResponse)
  }
}

process.on('message', async (msg: WorkerRequest) => {
  if (msg.type !== 'start') return

  const { task, model, apiKey, baseURL, systemPrompt, tools: allowedTools, maxTurns, cwd } = msg

  // Filter tool definitions to only the allowed set
  const filteredTools = TOOL_DEFINITIONS.filter(t => allowedTools.includes(t.function.name))

  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  let totalTokens = 0
  let responseText = ''
  let toolCallCount = 0

  try {
    for await (const event of streamChat(
      { apiKey, baseURL, model, systemPrompt },
      task,
      history,
      {
        onToolCall: async (name, args) => {
          toolCallCount++

          // maxTurns safety: stop accepting tool calls after limit
          if (toolCallCount > maxTurns) {
            return { success: false, output: `Sub-agent reached maxTurns limit (${maxTurns}). Stopping.` }
          }

          // Enforce the tool whitelist at runtime
          if (!allowedTools.includes(name)) {
            return { success: false, output: `Tool "${name}" is not allowed in this sub-agent.` }
          }

          // Report progress to parent
          sendProgress(totalTokens, toolCallCount)

          return executeTool(name, args, cwd)
        },
      },
      filteredTools as Array<Record<string, unknown>>,
    )) {
      switch (event.type) {
        case 'text':
          responseText += event.text || ''
          break
        case 'usage':
          totalTokens += (event.inputTokens || 0) + (event.outputTokens || 0)
          break
        case 'error':
          sendResult({
            success: false,
            output: event.error || 'Unknown sub-agent error',
            tokensUsed: totalTokens,
            toolCalls: toolCallCount,
          })
          return
        case 'done':
          break
      }
    }

    sendResult({
      success: true,
      output: responseText || '(no output)',
      tokensUsed: totalTokens,
      toolCalls: toolCallCount,
    })
  } catch (err) {
    sendResult({
      success: false,
      output: `Sub-agent error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
      toolCalls: toolCallCount,
    })
  }
})
