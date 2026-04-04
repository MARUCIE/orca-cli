/**
 * Forge CLI Hook System.
 *
 * Hooks are shell commands that run at specific lifecycle events.
 * They receive JSON on stdin and return JSON on stdout.
 * Hooks can block operations, inject context, or log events.
 *
 * 8 hook events (matching Claude Code):
 *   1. PreToolUse    — before tool execution (can block/modify)
 *   2. PostToolUse   — after tool execution (can log/modify output)
 *   3. SessionStart  — on REPL startup
 *   4. SessionEnd    — on clean exit
 *   5. PreCompact    — before /compact
 *   6. PostCompact   — after /compact
 *   7. UserPromptSubmit — before user prompt is sent to model
 *   8. SubagentStart — when a sub-agent spawns
 *
 * Configuration: .armature/hooks.json or hooks key in .armature.json
 *
 * Example hooks.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       { "matcher": "run_command", "command": "node scripts/check-safe.js" }
 *     ],
 *     "PostToolUse": [
 *       { "matcher": ".*", "command": "echo 'tool used'" }
 *     ],
 *     "SessionStart": [
 *       { "command": "bash scripts/load-context.sh" }
 *     ]
 *   }
 * }
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact'
  | 'UserPromptSubmit'
  | 'SubagentStart'

export interface HookDefinition {
  /** Shell command to execute */
  command: string
  /** Regex pattern to match tool name (for PreToolUse/PostToolUse) */
  matcher?: string
  /** Timeout in seconds (default: 10) */
  timeout?: number
}

export interface HookInput {
  event: HookEvent
  /** Tool name (for PreToolUse/PostToolUse) */
  toolName?: string
  /** Tool arguments (for PreToolUse) */
  toolInput?: Record<string, unknown>
  /** Tool output (for PostToolUse) */
  toolOutput?: string
  /** Tool success (for PostToolUse) */
  toolSuccess?: boolean
  /** User prompt (for UserPromptSubmit) */
  prompt?: string
  /** Working directory */
  cwd?: string
  /** Model name */
  model?: string
}

export interface HookResult {
  /** Whether to continue (false = block the operation) */
  continue?: boolean
  /** Reason for blocking */
  stopReason?: string
  /** Additional context to inject into the conversation */
  additionalContext?: string
  /** Modified tool input (for PreToolUse) */
  updatedInput?: Record<string, unknown>
  /** Warning message to display */
  systemMessage?: string
  /** Decision: approve or block (for PreToolUse) */
  decision?: 'approve' | 'block'
}

export type HookConfig = Record<HookEvent, HookDefinition[]>

// ── Hook Manager ─────────────────────────────────────────────────

export class HookManager {
  private hooks: Partial<HookConfig> = {}
  private loaded = false

  /** Load hooks from config file */
  load(cwd: string): void {
    if (this.loaded) return
    this.loaded = true

    const configPaths = [
      join(cwd, '.armature', 'hooks.json'),
      join(cwd, '.armature.json'),
      join(cwd, '.claude', 'hooks.json'),
    ]

    for (const configPath of configPaths) {
      if (!existsSync(configPath)) continue
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
        const hookConfig = raw.hooks || raw
        if (typeof hookConfig === 'object') {
          for (const [event, defs] of Object.entries(hookConfig)) {
            if (isHookEvent(event) && Array.isArray(defs)) {
              this.hooks[event] = defs as HookDefinition[]
            }
          }
        }
        break // use first found config
      } catch { /* ignore parse errors */ }
    }
  }

  /** Check if any hooks are registered for an event */
  hasHooks(event: HookEvent): boolean {
    return (this.hooks[event]?.length || 0) > 0
  }

  /** Get count of registered hooks */
  get totalHooks(): number {
    return Object.values(this.hooks).reduce((sum, defs) => sum + (defs?.length || 0), 0)
  }

  /** Run all hooks for an event. Returns aggregated result. */
  async run(event: HookEvent, input: HookInput): Promise<HookResult> {
    const defs = this.hooks[event]
    if (!defs || defs.length === 0) {
      return { continue: true }
    }

    const aggregated: HookResult = { continue: true }

    for (const def of defs) {
      // Check matcher for tool-specific hooks
      if (def.matcher && input.toolName) {
        const regex = new RegExp(def.matcher)
        if (!regex.test(input.toolName)) continue
      }

      try {
        const result = executeHook(def, input)
        // Merge results (last hook wins for conflicting keys)
        if (result.continue === false) {
          aggregated.continue = false
          aggregated.stopReason = result.stopReason
          aggregated.decision = 'block'
        }
        if (result.additionalContext) {
          aggregated.additionalContext = (aggregated.additionalContext || '') + '\n' + result.additionalContext
        }
        if (result.systemMessage) {
          aggregated.systemMessage = result.systemMessage
        }
        if (result.updatedInput) {
          aggregated.updatedInput = result.updatedInput
        }
        if (result.decision === 'approve') {
          aggregated.decision = 'approve'
        }
      } catch (err) {
        // Hook errors are non-fatal — log and continue
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`\x1b[33m  hook error (${event}): ${msg}\x1b[0m`)
      }
    }

    return aggregated
  }

  /** Print hook status summary */
  printStatus(): void {
    const total = this.totalHooks
    if (total === 0) {
      console.log('\x1b[90m  no hooks configured.\x1b[0m')
      return
    }
    console.log(`\x1b[90m  ${total} hooks loaded:\x1b[0m`)
    for (const [event, defs] of Object.entries(this.hooks)) {
      if (defs && defs.length > 0) {
        for (const def of defs) {
          const matcher = def.matcher ? ` [${def.matcher}]` : ''
          console.log(`\x1b[90m    ${event}${matcher}: ${def.command.slice(0, 60)}\x1b[0m`)
        }
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function isHookEvent(s: string): s is HookEvent {
  return ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd',
    'PreCompact', 'PostCompact', 'UserPromptSubmit', 'SubagentStart'].includes(s)
}

function executeHook(def: HookDefinition, input: HookInput): HookResult {
  const timeout = (def.timeout || 10) * 1000
  const inputJson = JSON.stringify(input)

  try {
    const output = execSync(def.command, {
      input: inputJson,
      encoding: 'utf-8',
      timeout,
      maxBuffer: 512 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORGE_HOOK_EVENT: input.event,
        FORGE_HOOK_TOOL: input.toolName || '',
        FORGE_CWD: input.cwd || '',
      },
    })

    if (!output.trim()) return { continue: true }

    try {
      return JSON.parse(output) as HookResult
    } catch {
      // If output isn't JSON, treat as additional context
      return { continue: true, additionalContext: output.trim() }
    }
  } catch (err) {
    const e = err as { status?: number; stderr?: string; stdout?: string }
    // Non-zero exit = block (for PreToolUse)
    if (e.status && e.status !== 0 && input.event === 'PreToolUse') {
      return {
        continue: false,
        stopReason: (e.stderr || e.stdout || 'Hook blocked the operation').trim(),
        decision: 'block',
      }
    }
    // For other events, non-zero is just a warning
    if (e.stderr) {
      console.error(`\x1b[33m  hook stderr: ${e.stderr.trim().slice(0, 200)}\x1b[0m`)
    }
    return { continue: true, additionalContext: (e.stdout || '').trim() || undefined }
  }
}

/** Singleton hook manager */
export const hooks = new HookManager()
