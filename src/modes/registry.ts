/**
 * Mode Registry — behavioral profiles that bundle role prompt,
 * tool subset, and custom instructions.
 *
 * Modes shape agent behavior without changing the underlying model.
 * Built-in modes cover common workflows; custom modes can be loaded
 * from .orca/modes.json.
 */

import { readFileSync } from 'node:fs'

// ── Types ────────────────────────────────────────────────────────

export interface Mode {
  id: string
  name: string
  description: string
  systemPromptPrefix: string // prepended to system prompt when active
  tools?: string[] // tool whitelist (undefined = all tools)
  instructions?: string // additional instructions appended to system prompt
}

// ── Built-in Modes ──────────────────────────────────────────────

const BUILTIN_MODES: Mode[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Full agent with all tools',
    systemPromptPrefix: '',
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Focus on reviewing code quality, security, and best practices',
    systemPromptPrefix:
      'You are in code review mode. Focus exclusively on reviewing code for bugs, security issues, performance problems, and style violations. Do not write new code — only analyze and suggest improvements.',
    tools: [
      'read_file',
      'search_files',
      'glob_files',
      'find_definition',
      'find_references',
      'git_diff',
      'git_log',
      'list_directory',
      'directory_tree',
    ],
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Systematic debugging with error tracing',
    systemPromptPrefix:
      'You are in debug mode. Systematically trace errors: reproduce \u2192 isolate \u2192 identify root cause \u2192 fix \u2192 verify. Always read error messages carefully before proposing solutions.',
    tools: [
      'read_file',
      'search_files',
      'glob_files',
      'edit_file',
      'run_command',
      'git_diff',
      'git_status',
      'list_directory',
    ],
  },
  {
    id: 'architect',
    name: 'Architect',
    description: 'System design and planning without code changes',
    systemPromptPrefix:
      'You are in architect mode. Focus on system design, architecture decisions, and planning. Analyze code structure and dependencies. Do NOT modify files \u2014 only create plans.',
    tools: [
      'read_file',
      'search_files',
      'glob_files',
      'find_definition',
      'find_references',
      'directory_tree',
      'count_lines',
      'list_directory',
      'create_plan',
    ],
  },
  {
    id: 'docs',
    name: 'Documentation',
    description: 'Write and improve documentation',
    systemPromptPrefix:
      'You are in documentation mode. Focus on writing clear, comprehensive documentation. Read existing code to understand it, then write or improve documentation files.',
    tools: [
      'read_file',
      'write_file',
      'edit_file',
      'search_files',
      'glob_files',
      'list_directory',
      'directory_tree',
    ],
  },
]

// ── Registry ────────────────────────────────────────────────────

export class ModeRegistry {
  private modes = new Map<string, Mode>()
  private activeMode: Mode

  constructor() {
    for (const mode of BUILTIN_MODES) {
      this.modes.set(mode.id, mode)
    }
    this.activeMode = this.modes.get('default')!
  }

  /** Load custom modes from a JSON file (e.g., .orca/modes.json) */
  loadFromFile(path: string): void {
    const raw = readFileSync(path, 'utf-8')
    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array of modes in ${path}`)
    }

    for (const entry of parsed) {
      const mode = entry as Mode
      if (!mode.id || !mode.name || typeof mode.systemPromptPrefix !== 'string') {
        continue // skip malformed entries
      }
      this.modes.set(mode.id, mode)
    }
  }

  /** Get active mode */
  getActive(): Mode {
    return this.activeMode
  }

  /** Switch to a mode by ID. Returns false if mode not found. */
  switchTo(id: string): boolean {
    const mode = this.modes.get(id)
    if (!mode) return false
    this.activeMode = mode
    return true
  }

  /** List all available modes */
  listModes(): Mode[] {
    return [...this.modes.values()]
  }

  /** Get mode by ID */
  getMode(id: string): Mode | undefined {
    return this.modes.get(id)
  }

  get modeCount(): number {
    return this.modes.size
  }
}
