/**
 * Sub-agent worker — runs in a forked child process.
 *
 * Receives a task via IPC, makes a single streaming API call
 * with restricted tools, and sends the result back to the parent.
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

process.on('message', async (msg: WorkerRequest) => {
  if (msg.type !== 'start') return

  const { task, model, apiKey, baseURL, systemPrompt, tools: allowedTools, cwd } = msg

  // Filter tool definitions to only the allowed set
  const filteredTools = TOOL_DEFINITIONS.filter(t => allowedTools.includes(t.function.name))

  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  let totalTokens = 0
  let responseText = ''

  try {
    for await (const event of streamChat(
      { apiKey, baseURL, model, systemPrompt },
      task,
      history,
      {
        onToolCall: async (name, args) => {
          // Enforce the tool whitelist at runtime
          if (!allowedTools.includes(name)) {
            return { success: false, output: `Tool "${name}" is not allowed in this sub-agent.` }
          }
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
          })
          return
        case 'done':
          // Final response
          break
      }
    }

    sendResult({
      success: true,
      output: responseText || '(no output)',
      tokensUsed: totalTokens,
    })
  } catch (err) {
    sendResult({
      success: false,
      output: `Sub-agent error: ${err instanceof Error ? err.message : String(err)}`,
      tokensUsed: totalTokens,
    })
  }
})
