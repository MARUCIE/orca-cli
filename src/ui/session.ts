/**
 * ChatSessionEmitter — the bridge between business logic and UI.
 *
 * Business logic (agent turns, slash commands, multi-model dispatch) emits
 * typed UIEvents. The UI layer (ink components or legacy renderer) subscribes
 * and renders them. This is the Presenter in the Presenter/Adapter pattern.
 *
 * Usage:
 *   const session = new ChatSessionEmitter()
 *   session.on('text', (e) => appendToOutput(e.text))
 *   session.on('status_update', (e) => updateStatusBar(e.info))
 *
 *   // In business logic:
 *   session.emitText('Hello, world!')
 *   session.emitToolStart({ name: 'read_file', args: { path: '/foo' } })
 */

import { EventEmitter } from 'node:events'
import type {
  UIEvent,
  StatusInfo,
  TurnSummaryInfo,
  SessionSummaryInfo,
  ToolStartInfo,
  ToolEndInfo,
  PermissionRequest,
  ModelProgress,
} from './types.js'

export class ChatSessionEmitter extends EventEmitter {
  /** Emit a raw UIEvent */
  emitUI(event: UIEvent): void {
    this.emit(event.type, event)
    this.emit('*', event) // wildcard for debugging / logging
  }

  // ── Convenience emitters ──────────────────────────────────

  emitText(text: string): void {
    this.emitUI({ type: 'text', text })
  }

  emitThinkingStart(): void {
    this.emitUI({ type: 'thinking_start' })
  }

  emitThinkingEnd(ttfbMs: number): void {
    this.emitUI({ type: 'thinking_end', ttfbMs })
  }

  emitToolStart(info: ToolStartInfo): void {
    this.emitUI({ type: 'tool_start', info })
  }

  emitToolEnd(info: ToolEndInfo): void {
    this.emitUI({ type: 'tool_end', info })
  }

  emitTurnSummary(info: TurnSummaryInfo): void {
    this.emitUI({ type: 'turn_summary', info })
  }

  emitStatusUpdate(info: StatusInfo): void {
    this.emitUI({ type: 'status_update', info })
  }

  emitSystemMessage(text: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.emitUI({ type: 'system_message', text, level })
  }

  /** Emit permission request and wait for UI response. Returns true if allowed. */
  emitPermissionRequest(req: { toolName: string; preview: string }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.emitUI({
        type: 'permission_request',
        request: { toolName: req.toolName, preview: req.preview, resolve },
      })
    })
  }

  emitMultiModelProgress(command: string, models: ModelProgress[]): void {
    this.emitUI({ type: 'multi_model_progress', command, models })
  }

  emitMultiModelResult(command: string, model: string, output: string, elapsedMs: number): void {
    this.emitUI({ type: 'multi_model_result', command, model, output, elapsedMs })
  }

  emitSessionEnd(info: SessionSummaryInfo): void {
    this.emitUI({ type: 'session_end', info })
  }

  emitPromptReady(): void {
    this.emitUI({ type: 'prompt_ready' })
  }

  emitAbort(): void {
    this.emitUI({ type: 'abort' })
  }

  emitClear(): void {
    this.emitUI({ type: 'clear' })
  }

  // ── UI commands (UI → business logic) ─────────────────────

  /** Emit a command from UI to business logic (e.g., mode-cycle, undo, clear-screen) */
  emitCommand(command: 'mode-cycle' | 'undo' | 'clear-screen'): void {
    this.emit('command', command)
  }

  /** Register handler for UI commands */
  onCommand(handler: (command: string) => void): void {
    this.on('command', handler)
  }

  // ── Input from UI to business logic ───────────────────────

  private inputResolve: ((input: string | null) => void) | null = null

  /** Called by UI when user submits input. Resolves the pending waitForInput promise. */
  submitInput(input: string | null): void {
    if (this.inputResolve) {
      const resolve = this.inputResolve
      this.inputResolve = null
      resolve(input)
    }
  }

  /** Called by business logic to wait for user input. Returns the input string or null (EOF). */
  waitForInput(): Promise<string | null> {
    this.emitPromptReady()
    return new Promise((resolve) => {
      this.inputResolve = resolve
    })
  }
}
