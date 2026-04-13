/**
 * Legacy Renderer — bridges ChatSessionEmitter to existing output.ts functions.
 *
 * This is a transitional adapter for Phase 1 of the ink migration.
 * It subscribes to UIEvents and calls the raw ANSI rendering functions
 * from output.ts. Once ink components replace output.ts, this file is deleted.
 */

import type { ChatSessionEmitter } from './session.js'
import type { UIEvent } from './types.js'
import {
  streamToken,
  printToolUse,
  printToolResult,
  printTurnSummary as legacyTurnSummary,
  printError,
  printWarning,
  printInfo,
  askPermission,
  ProgressIndicator,
  printSessionSummary,
} from '../output.js'
import type { TurnSummaryInfo as LegacyTurnInfo, SessionSummary } from '../output.js'

/** Attach legacy rendering to a session emitter. Returns a cleanup function. */
export function attachLegacyRenderer(session: ChatSessionEmitter): () => void {
  let thinkingIndicator: ProgressIndicator | null = null

  const handler = (event: UIEvent) => {
    switch (event.type) {
      case 'text':
        streamToken(event.text)
        break

      case 'thinking_start':
        thinkingIndicator = new ProgressIndicator()
        thinkingIndicator.start()
        break

      case 'thinking_end':
        if (thinkingIndicator) {
          thinkingIndicator.stop()
          thinkingIndicator = null
        }
        break

      case 'tool_start':
        printToolUse(event.info.name, event.info.label)
        break

      case 'tool_end':
        printToolResult(event.info.name, event.info.success, event.info.output)
        break

      case 'turn_summary': {
        const i = event.info
        const legacy: LegacyTurnInfo = {
          elapsedMs: i.duration,
          inputTokens: i.inputTokens,
          outputTokens: i.outputTokens,
          costUsd: i.costUsd,
          contextPct: 0, // filled by caller if needed
          tokPerSec: i.duration > 0 ? Math.round((i.outputTokens / i.duration) * 1000) : 0,
        }
        legacyTurnSummary(legacy)
        break
      }

      case 'system_message':
        if (event.level === 'error') printError(event.text)
        else if (event.level === 'warn') printWarning(event.text)
        else printInfo(event.text)
        break

      case 'permission_request':
        askPermission(event.request.toolName, event.request.preview)
          .then(allowed => event.request.resolve(allowed))
          .catch(() => event.request.resolve(false))
        break

      case 'session_end': {
        const s = event.info
        const legacy: SessionSummary = {
          turns: s.turns,
          totalInputTokens: s.totalInputTokens,
          totalOutputTokens: s.totalOutputTokens,
          durationMs: s.totalDuration,
          model: '', // legacy doesn't need model for summary display
        }
        printSessionSummary(legacy)
        break
      }

      // Events handled elsewhere or not needed in legacy:
      case 'status_update':
      case 'prompt_ready':
      case 'abort':
      case 'clear':
      case 'multi_model_progress':
      case 'multi_model_result':
        break
    }
  }

  session.on('*', handler)

  return () => {
    session.removeListener('*', handler)
    if (thinkingIndicator) thinkingIndicator.stop()
  }
}
