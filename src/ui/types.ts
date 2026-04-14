/**
 * Typed UI event system for Orca CLI.
 *
 * Business logic emits UIEvents → the UI layer (ink or legacy) consumes them.
 * This decouples rendering from agent logic, enabling ink migration without
 * rewriting the agent loop.
 */

// ── Status Bar ──────────────────────────────────────────────

export interface StatusInfo {
  model: string
  contextPct: number
  permMode: 'yolo' | 'auto' | 'plan'
  gitBranch?: string
  costUsd: number
  tokPerSec?: number
  /** Total turns in this session */
  turns: number
  /** Token usage per turn for sparkline (last N values) */
  sparkline?: number[]
}

// ── Turn Summary ────────────────────────────────────────────

export interface TurnSummaryInfo {
  inputTokens: number
  outputTokens: number
  thinkingTokens?: number
  cachedTokens?: number
  duration: number
  toolCalls: number
  costUsd: number
  model: string
}

// ── Session Summary ─────────────────────────────────────────

export interface SessionSummaryInfo {
  turns: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalDuration: number
  toolCallsTotal: number
}

// ── Tool Call ────────────────────────────────────────────────

export interface ToolStartInfo {
  name: string
  args: Record<string, unknown>
  /** Short description for display */
  label?: string
}

export interface ToolEndInfo {
  name: string
  success: boolean
  output: string
  durationMs: number
  /** Categorized error type for graduated rendering */
  errorType?: 'rejected' | 'permission' | 'timeout' | 'not_found' | 'validation' | 'generic'
}

// ── Multi-Model ─────────────────────────────────────────────

export interface ModelProgress {
  model: string
  done: boolean
  elapsedMs: number
  /** Output text once done */
  output?: string
}

// ── Permission ──────────────────────────────────────────────

export interface PermissionRequest {
  toolName: string
  preview: string
  resolve: (allowed: boolean) => void
  /** Diff data for file write permissions */
  diff?: {
    filePath: string
    oldContent: string
    newContent: string
  }
}

// ── UI Event Union ──────────────────────────────────────────

export type UIEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_end'; ttfbMs: number }
  | { type: 'tool_start'; info: ToolStartInfo }
  | { type: 'tool_end'; info: ToolEndInfo }
  | { type: 'turn_summary'; info: TurnSummaryInfo }
  | { type: 'status_update'; info: StatusInfo }
  | { type: 'system_message'; text: string; level: 'info' | 'warn' | 'error' }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'multi_model_progress'; command: string; models: ModelProgress[] }
  | { type: 'multi_model_result'; command: string; model: string; output: string; elapsedMs: number }
  | { type: 'session_end'; info: SessionSummaryInfo }
  | { type: 'prompt_ready' }
  | { type: 'abort' }
  | { type: 'clear' }
