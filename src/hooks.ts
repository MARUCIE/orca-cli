/**
 * Orca CLI Hook System — Claude Code compatible.
 *
 * Hooks are shell commands that run at specific lifecycle events.
 * They receive JSON on stdin and return JSON on stdout.
 * Hooks can block operations, inject context, or log events.
 *
 * 10 hook events (superset of Claude Code):
 *   1. PreToolUse       — before tool execution (can block/modify)
 *   2. PostToolUse      — after tool execution (can log/modify output)
 *   3. SessionStart     — on REPL startup
 *   4. SessionEnd       — on clean exit
 *   5. PreCompact       — before /compact
 *   6. PostCompact      — after /compact
 *   7. UserPromptSubmit — before user prompt is sent to model
 *   8. SubagentStart    — when a sub-agent spawns
 *   9. Stop             — when model stops generating (Claude Code compat)
 *  10. SubagentStop     — when a sub-agent finishes (Claude Code compat)
 *
 * Loads hooks from (priority order, all merged):
 *   1. .orca/hooks.json (native format)
 *   2. .claude/hooks.json (native JSON hook map)
 *   3. .claude/settings.json → hooks key (Claude Code format, auto-converted)
 *   4. .codex/hooks.json (Codex format)
 *
 * Claude Code format auto-detection:
 *   { matcher, hooks: [{ type, command, timeout }] } → flattened
 *   Timeout: ms → s conversion
 *   Env vars: CLAUDE_* passed alongside ORCA_* for compatibility
 */

import { execSync, spawn as spawnChild } from 'node:child_process'
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
  | 'Stop'
  | 'SubagentStop'

export interface HookDefinition {
  /** Shell command to execute */
  command: string
  /** Regex pattern to match tool name (for PreToolUse/PostToolUse) */
  matcher?: string
  /** Timeout in seconds (default: 10) */
  timeout?: number
  /** Run async (fire-and-forget) */
  async?: boolean
}

export interface HookInput {
  event: HookEvent
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolSuccess?: boolean
  prompt?: string
  cwd?: string
  model?: string
}

export interface HookResult {
  continue?: boolean
  stopReason?: string
  additionalContext?: string
  updatedInput?: Record<string, unknown>
  systemMessage?: string
  decision?: 'approve' | 'block'
}

export type HookConfig = Record<HookEvent, HookDefinition[]>

// ── Tool Name Mapping (Claude Code ↔ Orca) ─────────────────────

/** Map Claude Code tool names to Orca tool names for matcher compatibility */
const CLAUDE_TO_ORCA_TOOL: Record<string, string> = {
  Bash: 'run_command',
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'edit_file',
  MultiEdit: 'multi_edit',
  Grep: 'search_files',
  Glob: 'glob_files',
  Agent: 'spawn_agent',
  Skill: 'skill',
}

const ORCA_TO_CLAUDE_TOOL: Record<string, string> = {}
for (const [cc, orca] of Object.entries(CLAUDE_TO_ORCA_TOOL)) {
  ORCA_TO_CLAUDE_TOOL[orca] = cc
}

/** Get the Claude Code display name for an orca tool */
function claudeToolName(orcaName: string): string {
  return ORCA_TO_CLAUDE_TOOL[orcaName] || orcaName
}

// ── Hook Manager ─────────────────────────────────────────────────

export class HookManager {
  private hooks: Partial<HookConfig> = {}
  private loaded = false

  /**
   * Load hooks from all config sources (native + Claude Code + Codex).
   * All sources are merged — later sources add hooks, never override.
   */
  load(cwd: string): void {
    if (this.loaded) return
    this.loaded = true

    const home = process.env.HOME || '/tmp'

    // 1. Native Orca format
    this.loadNativeHooks([
      join(cwd, '.orca', 'hooks.json'),
      join(cwd, '.orca.json'),
      join(cwd, '.claude', 'hooks.json'),
    ])

    // 2. Claude Code format (.claude/settings.json — project then global)
    this.loadClaudeCodeHooks([
      join(cwd, '.claude', 'settings.json'),
      join(home, '.claude', 'settings.json'),
    ])

    // 3. Codex format (.codex/hooks.json)
    this.loadNativeHooks([
      join(home, '.codex', 'hooks.json'),
    ])
  }

  /** Load native Orca/Codex format: { hooks: { Event: [{ command, matcher, timeout }] } } */
  private loadNativeHooks(paths: string[]): void {
    for (const configPath of paths) {
      if (!existsSync(configPath)) continue
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
        const hookConfig = raw.hooks || raw
        if (typeof hookConfig === 'object' && !Array.isArray(hookConfig)) {
          for (const [event, defs] of Object.entries(hookConfig)) {
            if (isHookEvent(event) && Array.isArray(defs)) {
              this.addHooks(event, defs as HookDefinition[])
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  /**
   * Load Claude Code format from .claude/settings.json.
   *
   * Claude Code uses nested structure:
   *   { matcher: "Bash", hooks: [{ type: "command", command: "...", timeout: 5000 }] }
   *
   * Orca flattens to:
   *   { matcher: "run_command", command: "...", timeout: 5 }
   */
  private loadClaudeCodeHooks(paths: string[]): void {
    for (const settingsPath of paths) {
      if (!existsSync(settingsPath)) continue
      try {
        const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'))
        const hookConfig = raw.hooks
        if (!hookConfig || typeof hookConfig !== 'object') continue

        for (const [event, entries] of Object.entries(hookConfig)) {
          const forgeEvent = mapClaudeEvent(event)
          if (!forgeEvent) continue
          if (!Array.isArray(entries)) continue

          for (const entry of entries) {
            const e = entry as Record<string, unknown>
            const ccMatcher = (e.matcher as string) || ''
            const innerHooks = e.hooks as Array<Record<string, unknown>> | undefined

            if (!innerHooks || !Array.isArray(innerHooks)) continue

            for (const ih of innerHooks) {
              if (ih.type !== 'command' || !ih.command) continue

              // Convert matcher: Claude tool names → Orca tool names
              // Keep original matcher for regex patterns that span both
              const forgeMatcher = convertMatcher(ccMatcher)

              const def: HookDefinition = {
                command: String(ih.command),
                matcher: forgeMatcher || undefined,
                timeout: ih.timeout ? Math.ceil(Number(ih.timeout) / 1000) : undefined,
                async: ih.async === true ? true : undefined,
              }
              this.addHooks(forgeEvent, [def])
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  private addHooks(event: HookEvent, defs: HookDefinition[]): void {
    if (!this.hooks[event]) {
      this.hooks[event] = []
    }
    this.hooks[event]!.push(...defs)
  }

  hasHooks(event: HookEvent): boolean {
    return (this.hooks[event]?.length || 0) > 0
  }

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
        const orcaName = input.toolName
        const claudeName = claudeToolName(orcaName)
        // Match against both orca name and Claude name
        try {
          const regex = new RegExp(def.matcher)
          if (!regex.test(orcaName) && !regex.test(claudeName)) continue
        } catch {
          // Plain string match fallback
          if (def.matcher !== orcaName && def.matcher !== claudeName) continue
        }
      }

      // Fire-and-forget for async hooks
      if (def.async) {
        try { executeHookAsync(def, input) } catch { /* ignore */ }
        continue
      }

      try {
        const result = executeHook(def, input)
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
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`\x1b[33m  hook error (${event}): ${msg}\x1b[0m`)
      }
    }

    return aggregated
  }

  printStatus(): void {
    const total = this.totalHooks
    if (total === 0) return

    const events = Object.entries(this.hooks).filter(([, defs]) => defs && defs.length > 0).length
    console.log(`\x1b[90m  hooks: ${total} across ${events} events\x1b[0m`)
  }
}

// ── Helpers ───────────────────────────────────────────────────────

const HOOK_EVENTS: string[] = [
  'PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd',
  'PreCompact', 'PostCompact', 'UserPromptSubmit', 'SubagentStart',
  'Stop', 'SubagentStop',
]

function isHookEvent(s: string): s is HookEvent {
  return HOOK_EVENTS.includes(s)
}

/** Map Claude Code event names to Orca event names */
function mapClaudeEvent(event: string): HookEvent | null {
  if (isHookEvent(event)) return event
  // Claude Code aliases
  if (event === 'PermissionRequest') return 'PreToolUse' // closest equivalent
  return null
}

/** Convert Claude Code matcher patterns to work with Orca tool names.
 *  "Bash" → "run_command|Bash"  (match both)
 *  "Edit|Write" → "edit_file|write_file|Edit|Write"
 *  "*" or "" → undefined (match all)
 */
function convertMatcher(ccMatcher: string): string {
  if (!ccMatcher || ccMatcher === '*' || ccMatcher === '.*') return ''

  const parts = ccMatcher.split('|')
  const expanded: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    expanded.push(trimmed)
    const orcaEquiv = CLAUDE_TO_ORCA_TOOL[trimmed]
    if (orcaEquiv) expanded.push(orcaEquiv)
  }
  return expanded.join('|')
}

/** Build environment variables compatible with both Claude Code and Orca */
function buildHookEnv(input: HookInput): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> }

  // Orca native env vars
  env.ORCA_HOOK_EVENT = input.event
  env.ORCA_HOOK_TOOL = input.toolName || ''
  env.ORCA_CWD = input.cwd || process.cwd()

  // Claude Code compatible env vars
  env.CLAUDE_HOOK_EVENT = input.event
  env.CLAUDE_PROJECT_DIR = input.cwd || process.cwd()

  if (input.toolName) {
    env.CLAUDE_TOOL = claudeToolName(input.toolName)
  }
  if (input.toolInput) {
    env.CLAUDE_TOOL_INPUT = JSON.stringify(input.toolInput)
    // CLAUDE_FILE for file operations
    const filePath = input.toolInput.path || input.toolInput.file_path
    if (filePath) {
      env.CLAUDE_FILE = String(filePath)
    }
  }
  if (input.toolOutput) {
    env.CLAUDE_TOOL_OUTPUT = input.toolOutput.slice(0, 10000)
  }
  if (input.prompt) {
    env.CLAUDE_PROMPT = input.prompt
  }
  if (input.model) {
    env.CLAUDE_MODEL = input.model
  }

  return env
}

function executeHook(def: HookDefinition, input: HookInput): HookResult {
  const timeout = (def.timeout || 10) * 1000
  const inputJson = JSON.stringify(input)
  const env = buildHookEnv(input)

  try {
    const output = execSync(def.command, {
      input: inputJson,
      encoding: 'utf-8',
      timeout,
      maxBuffer: 512 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    if (!output.trim()) return { continue: true }

    try {
      return JSON.parse(output) as HookResult
    } catch {
      // Non-JSON output → treat as additional context / system message
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
    if (e.stderr) {
      console.error(`\x1b[33m  hook stderr: ${e.stderr.trim().slice(0, 200)}\x1b[0m`)
    }
    return { continue: true, additionalContext: (e.stdout || '').trim() || undefined }
  }
}

/** Fire-and-forget hook execution (for async: true hooks) */
function executeHookAsync(def: HookDefinition, input: HookInput): void {
  const env = buildHookEnv(input)
  const proc = spawnChild('bash', ['-c', def.command], {
    env,
    stdio: 'ignore',
    detached: true,
  })
  proc.unref()
}

/** Singleton hook manager */
export const hooks = new HookManager()
