/**
 * Orca CLI output formatting.
 *
 * Supports two modes:
 *   - streaming (interactive terminal): real-time token output with spinners
 *   - json (CI/headless): NDJSON event stream for machine consumption
 */

import chalk from 'chalk'
import { logError, logWarning } from './logger.js'

export type OutputMode = 'streaming' | 'json'

// ── Banner ──────────────────────────────────────────────────────────

const VERSION = '0.2.0'

// Orca — cute killer whale silhouette, all parts connected
// Features: dorsal fin, big eye (◕), black body (█), white belly (░), smooth tail taper
const ORCA_ART = [
  '\x1b[36m                   ▄▄\x1b[0m',
  '\x1b[36m                 ▄████▄\x1b[0m',
  '\x1b[36m                ████████\x1b[0m',
  '\x1b[36m          ▄▄▄████████████▄▄▄\x1b[0m',
  '\x1b[36m      ▄████████████████████████▄\x1b[0m',
  '\x1b[36m   ▄█████\x1b[0m \x1b[97m◕\x1b[36m ██████████████████████▄\x1b[0m',
  '\x1b[36m  ████████████████████████████████████████▄\x1b[0m',
  '\x1b[36m █████████████████████████████████████████████\x1b[0m',
  '\x1b[36m  ░░░░░░░░░░░░░░░░░░░░░░░░░████████████████████\x1b[0m',
  '\x1b[36m    ░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████▀\x1b[0m',
  '\x1b[36m       ░░░░░░░░░░░░░░░░░░░░░░░░░░░░██████████▀\x1b[0m',
  '\x1b[36m           ░░░░░░░░░░░░░░░░░░░░░░░░░░░█████▀\x1b[0m',
  '\x1b[36m                ░░░░░░░░░░░░░░░░░░░░░░░░▀▀\x1b[0m',
]

// Model context window sizes (for display)
const MODEL_CONTEXT: Record<string, string> = {
  'claude-opus-4':      '200K ctx · 32K out',
  'claude-sonnet-4':    '200K ctx · 64K out',
  'gpt-5':              '1M ctx · 64K out',
  'gemini-3':           '2M ctx · 65K out',
  'gemma-4':            '128K ctx · 8K out',
  'glm-5':              '128K ctx · 8K out',
  'grok-4':             '256K ctx · 32K out',
  'qwen3':              '128K ctx · 32K out',
  'kimi-k2':            '128K ctx · 32K out',
  'minimax-m2':         '256K ctx · 16K out',
}

function getModelSpec(model: string): string {
  const lower = model.toLowerCase()
  for (const [key, spec] of Object.entries(MODEL_CONTEXT)) {
    if (lower.includes(key)) return spec
  }
  return ''
}

function abbreviatePath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home && p.startsWith(home)) {
    return '~' + p.slice(home.length)
  }
  return p
}

/** Strip ANSI escape codes to get visible character length */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Rich startup banner with swimming orca animation.
 * The orca swims left-right across the terminal, then settles at center.
 */
export async function printRichBanner(opts: {
  provider: string
  model: string
  cwd: string
  configFiles?: string[]
  toolCount?: number
  mode?: 'yolo' | 'safe'
}): Promise<void> {
  const { provider, model, cwd, configFiles, toolCount, mode } = opts
  const shortCwd = abbreviatePath(cwd)
  const cols = process.stdout.columns || 80
  const artHeight = ORCA_ART.length
  const maxVisWidth = Math.max(...ORCA_ART.map(l => stripAnsi(l).length))

  // Starting position (right side, clamped to prevent overflow) and ending position (left side)
  const maxPad = Math.max(0, cols - maxVisWidth - 2)
  const startPad = Math.min(maxPad, Math.max(0, cols - maxVisWidth - 4))
  const endPad = 2
  const amplitude = Math.min(Math.floor(maxPad / 4), 12)

  // Only animate if terminal is wide enough and interactive
  const canAnimate = process.stdout.isTTY && amplitude > 2 && cols > maxVisWidth + 10

  if (!canAnimate) {
    // Static fallback
    console.log()
    for (const line of ORCA_ART) console.log(`  ${line}`)
  } else {
    // Hide cursor during animation
    process.stdout.write('\x1b[?25l')
    console.log()

    // Print initial frame (start from right side)
    for (const line of ORCA_ART) {
      const pad = ' '.repeat(startPad)
      console.log(`${pad}${line}`)
    }

    // Swimming animation: body-wave undulation + drift from right to left
    // Each line gets a phase-shifted sine offset — simulates the S-curve
    // of a whale's swimming stroke (head leads, wave propagates to tail)
    const totalFrames = 54
    const frameDuration = 75
    const bodyWaveAmp = 3  // how far each line can deviate from its neighbors
    const phaseSpread = 0.45  // phase difference between adjacent lines (wave tightness)

    for (let frame = 0; frame < totalFrames; frame++) {
      const progress = frame / totalFrames
      // Ease-out drift from startPad to endPad
      const ease = 1 - Math.pow(1 - progress, 2)
      const drift = startPad + (endPad - startPad) * ease
      // Overall oscillation (damped)
      const t = progress * Math.PI * 5  // 2.5 swim-stroke cycles
      const globalWave = Math.sin(t) * amplitude * (1 - progress * 0.7)

      // Move cursor up to top of art
      process.stdout.write(`\x1b[${artHeight}A`)

      // Redraw each line with body-wave deformation
      for (let i = 0; i < ORCA_ART.length; i++) {
        const baseShift = Math.round(drift + globalWave)
        // Body wave: tail lines flex more than head lines
        const tailFactor = 0.3 + (i / artHeight) * 0.7  // 0.3 at head → 1.0 at tail
        const bodyWave = Math.round(Math.sin(t + i * phaseSpread) * bodyWaveAmp * tailFactor)
        const totalShift = Math.max(0, Math.min(maxPad, baseShift + bodyWave))
        const pad = ' '.repeat(totalShift)
        process.stdout.write(`\x1b[2K${pad}${ORCA_ART[i]}\n`)
      }

      await new Promise(r => setTimeout(r, frameDuration))
    }

    // Final settle: ease into left position with one last gentle wave
    const settleFrames = 8
    for (let f = 0; f < settleFrames; f++) {
      const sp = f / settleFrames
      process.stdout.write(`\x1b[${artHeight}A`)
      for (let i = 0; i < ORCA_ART.length; i++) {
        const tailFactor = 0.3 + (i / artHeight) * 0.7
        const residual = Math.round(Math.sin(i * phaseSpread) * bodyWaveAmp * tailFactor * (1 - sp))
        const pad = ' '.repeat(Math.max(0, endPad + residual))
        process.stdout.write(`\x1b[2K${pad}${ORCA_ART[i]}\n`)
      }
      await new Promise(r => setTimeout(r, 60))
    }

    // Final static frame: perfectly still
    process.stdout.write(`\x1b[${artHeight}A`)
    for (const line of ORCA_ART) {
      const pad = ' '.repeat(endPad)
      process.stdout.write(`\x1b[2K${pad}${line}\n`)
    }

    // Show cursor
    process.stdout.write('\x1b[?25h')
  }

  // Info below the art
  console.log()
  console.log(`  \x1b[1;37mOrca\x1b[0m  \x1b[90mv${VERSION}\x1b[0m`)
  console.log(`  \x1b[90mprovider-neutral agent runtime\x1b[0m`)
  console.log(`  \x1b[36m▸\x1b[0m \x1b[90m${shortCwd}\x1b[0m`)

  // Extra info
  if (configFiles && configFiles.length > 0) {
    console.log(`  \x1b[90mconfig: ${configFiles.join(', ')}\x1b[0m`)
  }
  if (toolCount) {
    console.log(`  \x1b[90m${toolCount} tools · 8 hooks\x1b[0m`)
  }
  console.log()
}

/** Simple banner for non-interactive / one-shot mode */
export function printBanner(toolCount?: number): void {
  const tools = toolCount ? `${toolCount} tools` : 'multi-model'
  console.log(chalk.blue.bold(`\n  orca`) + chalk.gray(` v${VERSION}`) + chalk.gray(` — provider-neutral agent runtime`))
  console.log(chalk.gray(`  multi-model · ${tools}\n`))
}

export function printProviderInfo(provider: string, model: string): void {
  const spec = getModelSpec(model)
  console.log(
    chalk.gray('  ') +
    chalk.cyan('▸') +
    chalk.gray(` ${provider}/`) +
    chalk.white.bold(model) +
    (spec ? chalk.gray(`  ${spec}`) : '') +
    '\n'
  )
}

export function printProjectContext(cwd: string, configFiles: string[]): void {
  console.log(chalk.gray(`  cwd: ${abbreviatePath(cwd)}`))
  if (configFiles.length > 0) {
    console.log(chalk.gray(`  config: ${configFiles.join(', ')}`))
  }
  console.log()
}

// ── Errors with Classification ──────────────────────────────────────

export function printError(message: string): void {
  const classified = classifyError(message)
  logError(classified.message)
  console.error(chalk.red.bold(`  error: `) + chalk.red(classified.message))
  if (classified.suggestion) {
    console.error(chalk.yellow(`  hint: ${classified.suggestion}`))
  }
}

export function printWarning(message: string): void {
  logWarning(message)
  console.error(chalk.yellow.bold('  warn: ') + chalk.yellow(message))
}

export function printSuccess(message: string): void {
  console.log(chalk.green.bold('  ') + chalk.green(message))
}

export function printInfo(message: string): void {
  console.log(chalk.gray('  ') + chalk.gray(message))
}

interface ClassifiedError {
  message: string
  suggestion?: string
}

function classifyError(message: string): ClassifiedError {
  const lower = message.toLowerCase()

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return {
      message,
      suggestion: 'Check your API key. Set ORCA_API_KEY or POE_API_KEY environment variable.',
    }
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      message,
      suggestion: 'Rate limited. Wait a moment and try again, or switch to a different model with /model.',
    }
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('unavailable')) {
    return {
      message,
      suggestion: 'Model not found on this provider. Check model name. Poe uses names like Claude-Sonnet-4, GPT-4o, Gemini-2.5-Pro.',
    }
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      message,
      suggestion: 'Request timed out. Check network/proxy. Try: export HTTPS_PROXY=http://127.0.0.1:<port>',
    }
  }
  if (lower.includes('connection') || lower.includes('econnrefused') || lower.includes('network')) {
    return {
      message,
      suggestion: 'Network error. Check internet connection and proxy settings.',
    }
  }
  if (lower.includes('500') || lower.includes('internal server error')) {
    return {
      message,
      suggestion: 'Server error from provider. Try again or switch model.',
    }
  }

  return { message }
}

// ── Permission Prompt ──────────────────────────────────────────────────

/**
 * Ask the user for permission to execute a dangerous tool.
 * Returns true if approved, false if denied.
 * Uses raw stdin keypress (y/n) — works during agent loop.
 */
export function askPermission(toolName: string, preview: string): Promise<boolean> {
  return new Promise((resolve) => {
    const displayName = toolName === 'write_file' ? 'Write' : toolName === 'run_command' ? 'Bash' : toolName
    console.log()
    console.log(chalk.yellow(`  ⚠ ${displayName}: `) + chalk.white(preview))
    process.stdout.write(chalk.gray('  allow? ') + chalk.cyan('y') + chalk.gray('/') + chalk.cyan('n') + chalk.gray(' › '))

    const isTTY = process.stdin.isTTY
    if (!isTTY) {
      // Non-interactive: auto-approve
      console.log(chalk.green('y') + chalk.gray(' (auto, non-interactive)'))
      resolve(true)
      return
    }

    const wasRaw = process.stdin.isRaw
    process.stdin.setRawMode(true)
    process.stdin.resume()

    const handler = (data: Buffer) => {
      const key = String.fromCharCode(data[0]!).toLowerCase()
      process.stdin.removeListener('data', handler)
      if (!wasRaw) process.stdin.setRawMode(false)

      if (key === 'y' || key === '\r') {
        console.log(chalk.green('yes'))
        resolve(true)
      } else {
        console.log(chalk.red('no'))
        resolve(false)
      }
    }

    process.stdin.on('data', handler)
  })
}

// ── Diff Display ──────────────────────────────────────────────────────

export function printDiffPreview(oldContent: string, newContent: string, maxLines = 12): void {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // Simple line-by-line diff
  const diffLines: Array<{ type: '+' | '-' | ' '; text: string }> = []
  const maxLen = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i]! : undefined
    const newLine = i < newLines.length ? newLines[i]! : undefined

    if (oldLine === newLine) {
      diffLines.push({ type: ' ', text: oldLine! })
    } else {
      if (oldLine !== undefined) diffLines.push({ type: '-', text: oldLine })
      if (newLine !== undefined) diffLines.push({ type: '+', text: newLine })
    }
  }

  // Show only changed lines with context
  const changedIndices = diffLines.map((d, i) => d.type !== ' ' ? i : -1).filter(i => i >= 0)
  if (changedIndices.length === 0) return

  let shown = 0
  const printed = new Set<number>()

  for (const idx of changedIndices) {
    if (shown >= maxLines) {
      console.log(chalk.gray(`  │ ... ${changedIndices.length - shown} more changes`))
      break
    }

    // Show 1 line of context before
    const ctxStart = Math.max(0, idx - 1)
    for (let i = ctxStart; i <= idx; i++) {
      if (printed.has(i)) continue
      printed.add(i)
      const d = diffLines[i]!
      if (d.type === '+') {
        console.log(chalk.green(`  │ + ${truncateLine(d.text, 70)}`))
      } else if (d.type === '-') {
        console.log(chalk.red(`  │ - ${truncateLine(d.text, 70)}`))
      } else {
        console.log(chalk.gray(`  │   ${truncateLine(d.text, 70)}`))
      }
      if (d.type !== ' ') shown++
    }
  }
}

function truncateLine(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}

// ── Separator + Status Line ────────────────────────────────────────

/**
 * Print a separator line between output and prompt (like Claude Code).
 * Uses a lighter style to frame the input area.
 */
export function printSeparator(): void {
  const cols = process.stdout.columns || 80
  const width = Math.min(cols - 2, 80)
  console.log(`\x1b[90m${'─'.repeat(width)}\x1b[0m`)
}

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max'

export interface StatusLineInfo {
  model: string
  provider: string
  mode: 'yolo' | 'safe'
  contextChars: number
  totalTokens: number
  cwd: string
  gitBranch?: string
  effort?: ThinkingEffort
}

/**
 * Print the status line below the separator, above the prompt.
 * Shows: model · context bar · project · git branch · tokens · mode
 */
export function printStatusLine(info: StatusLineInfo): void {
  const cols = process.stdout.columns || 80

  // Context bar
  const estimatedTokens = Math.round(info.contextChars / 4)
  const maxTokens = 200_000
  const pct = Math.min(100, Math.round((estimatedTokens / maxTokens) * 100))
  const barLen = 6
  const filled = Math.round((pct / 100) * barLen)
  const empty = barLen - filled
  let barColor = '\x1b[32m'  // green
  if (pct >= 60) barColor = '\x1b[31m'
  else if (pct >= 40) barColor = '\x1b[33m'
  const bar = `${barColor}${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m`

  // Git branch
  const gitPart = info.gitBranch ? ` \x1b[90mgit:(\x1b[32m${info.gitBranch}\x1b[90m)\x1b[0m` : ''

  // Project name (last directory component)
  const project = info.cwd.split('/').filter(Boolean).pop() || '~'

  // Mode
  const modeTag = info.mode === 'yolo'
    ? '\x1b[33m▸▸ yolo\x1b[0m'
    : '\x1b[32m▸▸ safe\x1b[0m'

  // Thinking effort indicator
  const effortDisplay: Record<ThinkingEffort, string> = {
    low:    '\x1b[90m⚡low\x1b[0m',
    medium: '\x1b[33m⚡⚡med\x1b[0m',
    high:   '\x1b[36m⚡⚡⚡high\x1b[0m',
    max:    '\x1b[35m⚡⚡⚡⚡max\x1b[0m',
  }
  const effort = info.effort || 'high'
  const effortTag = effortDisplay[effort]

  // Model short
  const modelShort = info.model.length > 20 ? info.model.slice(0, 18) + '..' : info.model

  // Tokens right-aligned
  const tokenStr = `${info.totalTokens.toLocaleString()} tokens`

  // Left side: ◇ ORCA │ model │ ██░░ 15% │ project git:(branch)
  const left = `\x1b[36m◇\x1b[0m \x1b[1;37mORCA\x1b[0m \x1b[90m│\x1b[0m ${modelShort} \x1b[90m│\x1b[0m ${bar} ${pct}% \x1b[90m│\x1b[0m \x1b[36m${project}\x1b[0m${gitPart}`

  // Print status line
  console.log(`${left}`)
  console.log(`${modeTag} \x1b[90m│\x1b[0m ${effortTag}${' '.repeat(Math.max(0, cols - 45 - tokenStr.length))}\x1b[90m${tokenStr}\x1b[0m`)
}

// ── Progress Indicator ──────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return `${min}m ${remSec}s`
}

/**
 * Animated progress indicator during generation.
 * Shows "Working (Xm Ys · ↓ N tokens • esc to interrupt)" on stderr,
 * updating in-place without polluting stdout's streaming text.
 */
export class ProgressIndicator {
  private interval: ReturnType<typeof setInterval> | null = null
  private startTime: number = 0
  private tokenCount: number = 0
  private phase: 'thinking' | 'working' = 'thinking'
  private spinIdx: number = 0
  private readonly thinkFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private lastLineLen: number = 0

  start(): void {
    this.startTime = Date.now()
    this.phase = 'thinking'
    this.spinIdx = 0
    this.tokenCount = 0
    this.lastLineLen = 0
    this.interval = setInterval(() => this.render(), 100)
  }

  /** Switch from "thinking" to "working" once first token arrives */
  markWorking(): void {
    this.phase = 'working'
  }

  addTokens(n: number): void {
    this.tokenCount += n
  }

  private render(): void {
    const elapsed = formatElapsed(Date.now() - this.startTime)
    const frame = this.thinkFrames[this.spinIdx % this.thinkFrames.length]!
    this.spinIdx++

    let line: string
    if (this.phase === 'thinking') {
      line = `  ${frame} Thinking... (${elapsed} • esc to interrupt)`
    } else {
      const tokStr = this.tokenCount > 0 ? ` · ↓ ${this.tokenCount.toLocaleString()} tokens` : ''
      line = `  ${frame} Working (${elapsed}${tokStr} • esc to interrupt)`
    }

    // Write to stderr to avoid polluting stdout's streamed text
    const clearLen = Math.max(this.lastLineLen, line.length)
    process.stderr.write(`\r\x1b[90m${line.padEnd(clearLen)}\x1b[0m`)
    this.lastLineLen = line.length
  }

  /** Clear the progress line and stop the timer */
  stop(): { elapsed: number; tokens: number } {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.lastLineLen > 0) {
      process.stderr.write(`\r${' '.repeat(this.lastLineLen)}\r`)
      this.lastLineLen = 0
    }
    return { elapsed: Date.now() - this.startTime, tokens: this.tokenCount }
  }
}

// ── Streaming Text ──────────────────────────────────────────────────

let lastWasNewline = true

export function streamToken(text: string): void {
  process.stdout.write(text)
  lastWasNewline = text.endsWith('\n')
}

export function ensureNewline(): void {
  if (!lastWasNewline) {
    process.stdout.write('\n')
    lastWasNewline = true
  }
}

export function setLastNewline(value: boolean): void {
  lastWasNewline = value
}

// ── Tool Use Display (Claude Code style) ────────────────────────────

const toolTimers = new Map<string, number>()
let toolCallCount = 0

export function printToolUse(toolName: string, input?: string): void {
  ensureNewline()
  toolCallCount++
  toolTimers.set(toolName + '_' + toolCallCount, Date.now())

  // Parse input JSON for rich display
  let richDisplay = ''
  try {
    if (input) {
      const args = JSON.parse(input)
      richDisplay = formatToolArgs(toolName, args)
    }
  } catch {
    richDisplay = input ? truncate(input, 70) : ''
  }

  // Claude Code style: ● ToolName(context)
  const icon = chalk.magenta('●')
  const name = chalk.white.bold(formatToolName(toolName))
  const context = richDisplay ? chalk.gray(`(${richDisplay})`) : ''

  console.log(`  ${icon} ${name}${context}`)
}

export function printToolResult(toolName: string, success: boolean, output?: string): void {
  const timerKey = [...toolTimers.keys()].find(k => k.startsWith(toolName + '_'))
  const startTime = timerKey ? toolTimers.get(timerKey) : undefined
  const duration = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : '0.0'
  if (timerKey) toolTimers.delete(timerKey)

  const icon = success ? chalk.green('  ✓') : chalk.red('  ✗')
  const timeStr = chalk.gray(` ${duration}s`)

  // Show result preview for read operations
  if (output && success) {
    const preview = getResultPreview(toolName, output)
    if (preview) {
      console.log(chalk.gray(`  │ ${preview}`))
    }
  }

  console.log(`${icon}${timeStr}`)
}

function formatToolName(name: string): string {
  const MAP: Record<string, string> = {
    read_file: 'Read', write_file: 'Write', edit_file: 'Edit', multi_edit: 'MultiEdit',
    list_directory: 'ListDir', run_command: 'Bash', search_files: 'Search', glob_files: 'Glob',
    delete_file: 'Delete', move_file: 'Move', copy_file: 'Copy', create_directory: 'Mkdir',
    file_info: 'FileInfo', find_definition: 'FindDef', find_references: 'FindRef',
    directory_tree: 'Tree', count_lines: 'CountLines', patch_file: 'Patch',
    git_status: 'GitStatus', git_diff: 'GitDiff', git_log: 'GitLog', git_commit: 'GitCommit',
    fetch_url: 'Fetch', run_background: 'BgRun', check_port: 'CheckPort',
  }
  return MAP[name] || name
}

function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'read_file': {
      const path = String(args.path || '')
      const range = args.start_line ? `:${args.start_line}-${args.end_line || ''}` : ''
      return path + range
    }
    case 'write_file': {
      const path = String(args.path || '')
      const size = String(args.content || '').length
      return `${path}, ${size} bytes`
    }
    case 'list_directory': {
      const path = String(args.path || '.')
      return args.recursive ? `${path}, recursive` : path
    }
    case 'run_command':
      return truncate(String(args.command || ''), 60)
    case 'search_files': {
      const pattern = String(args.pattern || '')
      const path = String(args.path || '.')
      const glob = args.file_glob ? ` ${args.file_glob}` : ''
      return `"${pattern}" in ${path}${glob}`
    }
    case 'edit_file': {
      const path = String(args.path || '')
      const oldStr = String(args.old_string || '').slice(0, 30)
      return `${path}, "${oldStr}${String(args.old_string || '').length > 30 ? '...' : ''}"`
    }
    case 'glob_files': {
      const pattern = String(args.pattern || '')
      const path = args.path ? ` in ${args.path}` : ''
      return `${pattern}${path}`
    }
    default:
      return ''
  }
}

function getResultPreview(toolName: string, output: string): string {
  switch (toolName) {
    case 'read_file': {
      const lines = output.split('\n')
      return `${lines.length} lines`
    }
    case 'list_directory': {
      const entries = output.split('\n').filter(Boolean)
      return `${entries.length} entries`
    }
    case 'run_command': {
      const firstLine = output.split('\n')[0] || ''
      return truncate(firstLine, 60)
    }
    case 'search_files': {
      const matches = output.split('\n').filter(Boolean)
      return matches.length > 0 && output !== 'No matches found.'
        ? `${matches.length} matches`
        : 'no matches'
    }
    case 'write_file':
    case 'edit_file':
      return output
    case 'glob_files': {
      const files = output.split('\n').filter(Boolean)
      return `${files.length} files`
    }
    default:
      return ''
  }
}

// ── JSON/NDJSON Output ──────────────────────────────────────────────

export function emitJson(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...event, timestamp: new Date().toISOString() }))
}

// ── Usage Summary ───────────────────────────────────────────────────

export interface UsageSummary {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd?: number
  turns: number
  durationMs: number
  model?: string
  contextChars?: number
  budgetUsd?: number       // max budget for warning
  sessionCostUsd?: number  // cumulative session cost
}

export function printUsageSummary(usage: UsageSummary): void {
  ensureNewline()
  const cost = usage.costUsd ?? estimateCost(usage.model || '', usage.inputTokens, usage.outputTokens)
  const durationSec = usage.durationMs / 1000
  const tokPerSec = durationSec > 0 && usage.outputTokens > 0
    ? (usage.outputTokens / durationSec).toFixed(0)
    : null
  const parts = [
    `${usage.turns} turn${usage.turns !== 1 ? 's' : ''}`,
    `${formatTokens(usage.totalTokens)} tokens`,
    `${durationSec.toFixed(1)}s`,
  ]
  if (tokPerSec) {
    parts.push(`${tokPerSec} tok/s`)
  }
  if (cost > 0) {
    parts.push(`$${cost.toFixed(4)}`)
  }

  // Context usage bar (if context chars provided)
  let ctxBar = ''
  if (usage.contextChars && usage.contextChars > 0) {
    ctxBar = renderContextBar(usage.contextChars)
  }

  console.log(chalk.gray(`\n  ─ ${parts.join(' · ')}${ctxBar} ─`))

  // Budget warning
  if (usage.budgetUsd && usage.sessionCostUsd) {
    const pct = Math.round((usage.sessionCostUsd / usage.budgetUsd) * 100)
    if (pct >= 90) {
      console.log(chalk.red(`  ⚠ budget: $${usage.sessionCostUsd.toFixed(4)} / $${usage.budgetUsd.toFixed(2)} (${pct}%) — approaching limit`))
    } else if (pct >= 70) {
      console.log(chalk.yellow(`  budget: $${usage.sessionCostUsd.toFixed(4)} / $${usage.budgetUsd.toFixed(2)} (${pct}%)`))
    }
  }
  console.log()
}

/**
 * Render a visual context usage bar.
 * Assumes ~4 chars per token, ~200K context window.
 */
function renderContextBar(chars: number): string {
  const estimatedTokens = Math.round(chars / 4)
  const maxTokens = 200_000
  const pct = Math.min(100, Math.round((estimatedTokens / maxTokens) * 100))

  const barLen = 12
  const filled = Math.round((pct / 100) * barLen)
  const empty = barLen - filled

  let color: string
  if (pct < 40) color = '\x1b[32m'       // green
  else if (pct < 60) color = '\x1b[33m'  // yellow
  else color = '\x1b[31m'                // red

  const bar = `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m`
  return ` · ctx ${bar} ${pct}%`
}

// ── Session Summary (on exit) ───────────────────────────────────────

export interface SessionSummary {
  turns: number
  totalInputTokens: number
  totalOutputTokens: number
  durationMs: number
  model: string
}

export function printSessionSummary(session: SessionSummary): void {
  if (session.turns === 0) return

  const totalTokens = session.totalInputTokens + session.totalOutputTokens
  const cost = estimateCost(session.model, session.totalInputTokens, session.totalOutputTokens)
  const duration = (session.durationMs / 1000).toFixed(0)

  console.log(chalk.gray('\n  ─────────────────────────────────'))
  console.log(chalk.gray(`  session: ${session.turns} turns · ${formatTokens(totalTokens)} tokens · ${duration}s`))
  if (cost > 0) {
    console.log(chalk.gray(`  cost: $${cost.toFixed(4)}`))
  }
  console.log(chalk.gray('  ─────────────────────────────────\n'))
}

// ── Cost Estimation ─────────────────────────────────────────────────

// Approximate pricing per 1M tokens (input / output)
const MODEL_PRICING: Record<string, [number, number]> = {
  // Anthropic
  'claude-opus':     [15, 75],
  'claude-sonnet':   [3, 15],
  'claude-haiku':    [0.25, 1.25],
  // OpenAI
  'gpt-4o':          [2.5, 10],
  'gpt-4.1':         [2, 8],
  'gpt-4.1-mini':    [0.4, 1.6],
  'o3':              [10, 40],
  'o4-mini':         [1.1, 4.4],
  // Google
  'gemini-2.5-pro':  [1.25, 10],
  'gemini-2.5-flash': [0.15, 0.6],
  // Poe (approximate, includes Poe margin)
  'poe':             [3, 15],  // fallback for Poe models
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const lower = model.toLowerCase()

  // Find best matching pricing tier
  let pricing: [number, number] | undefined
  for (const [key, value] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) {
      pricing = value
      break
    }
  }
  if (!pricing) pricing = MODEL_PRICING['poe'] // default fallback

  const [inputPer1M, outputPer1M] = pricing!
  return (inputTokens * inputPer1M + outputTokens * outputPer1M) / 1_000_000
}

// ── Helpers ─────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\n/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 3) + '...' : oneLine
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
