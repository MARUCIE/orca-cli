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

// ── Theme ──────────────────────────────────────────────────────────

interface OrcaTheme {
  accent: string    // ANSI color code for primary accent
  prompt: string    // prompt icon color
  success: string   // success color
  dim: string       // dim/secondary text
  name: string
}

const THEMES: Record<string, OrcaTheme> = {
  default: { accent: '\x1b[36m', prompt: '\x1b[36m', success: '\x1b[32m', dim: '\x1b[90m', name: 'default' },
  dark:    { accent: '\x1b[32m', prompt: '\x1b[32m', success: '\x1b[32m', dim: '\x1b[90m', name: 'dark' },
  ocean:   { accent: '\x1b[34m', prompt: '\x1b[34m', success: '\x1b[36m', dim: '\x1b[90m', name: 'ocean' },
  warm:    { accent: '\x1b[33m', prompt: '\x1b[33m', success: '\x1b[32m', dim: '\x1b[90m', name: 'warm' },
  mono:    { accent: '\x1b[37m', prompt: '\x1b[37m', success: '\x1b[37m', dim: '\x1b[90m', name: 'mono' },
}

const themeId = (process.env.ORCA_THEME || 'default').toLowerCase()
export const theme: OrcaTheme = THEMES[themeId] || THEMES['default']!
const RST = '\x1b[0m'

// ── Banner ──────────────────────────────────────────────────────────

const VERSION = '0.6.0'

// Orca — cute killer whale with dorsal fin, eye patch, body, belly, and iconic tail flukes
// Tail section: body narrows → peduncle → flukes fork up/down (whale signature)
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
  '\x1b[36m           ░░░░░░░░░░░░░░░░░░░░░░░░░░░████▀▄██▀\x1b[0m',
  '\x1b[36m                ░░░░░░░░░░░░░░░░░░░░░░░░▀████▀\x1b[0m',
  '\x1b[36m                                         ▀████▄\x1b[0m',
  '\x1b[36m                                           ▀▀\x1b[0m',
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
  hookCount?: number
  mode?: 'yolo' | 'auto' | 'plan'
}): Promise<void> {
  const { provider, model, cwd, configFiles, toolCount, hookCount, mode } = opts
  const shortCwd = abbreviatePath(cwd)
  const cols = process.stdout.columns || 80
  const artHeight = ORCA_ART.length
  const maxVisWidth = Math.max(...ORCA_ART.map(l => stripAnsi(l).length))

  // Starting position (right side, clamped to prevent overflow) and ending position (left side)
  const maxPad = Math.max(0, cols - maxVisWidth - 2)
  const startPad = Math.min(maxPad, Math.max(0, cols - maxVisWidth - 4))
  const endPad = 2
  const amplitude = Math.min(Math.floor(maxPad / 4), 12)

  // Only animate if terminal is wide enough and interactive (skip with ORCA_NO_ANIMATION=1)
  const canAnimate = process.stdout.isTTY && amplitude > 2 && cols > maxVisWidth + 10 && !process.env.ORCA_NO_ANIMATION

  if (!canAnimate) {
    // Static fallback
    console.log()
    for (const line of ORCA_ART) console.log(`  ${line}`)
  } else {
    // Hide cursor during animation (restored in finally block)
    process.stdout.write('\x1b[?25l')
    try {
    console.log()

    // Print initial frame (start from right side)
    for (const line of ORCA_ART) {
      const pad = ' '.repeat(startPad)
      console.log(`${pad}${line}`)
    }

    // Swimming animation: body-wave undulation + drift from right to left
    // Each line gets a phase-shifted sine offset — simulates the S-curve
    // of a whale's swimming stroke (head leads, wave propagates to tail)
    const totalFrames = 20
    const frameDuration = 60
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
    const settleFrames = 3
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

    } finally {
      // Always restore cursor, even if animation errors out
      process.stdout.write('\x1b[?25h')
    }
  }

  // Info below the art — aligned, clean layout
  const label = theme.dim
  const reset = RST
  const accent = theme.accent
  console.log()
  console.log(`  \x1b[1;37mOrca\x1b[0m \x1b[90mv${VERSION}\x1b[0m  ${label}provider-neutral agent runtime${reset}`)
  console.log(`  ${accent}▸${reset} ${label}${shortCwd}${reset}`)
  if (configFiles && configFiles.length > 0) {
    console.log(`  ${label}config  ${configFiles.join(', ')}${reset}`)
  }
  if (toolCount) {
    const hooksLabel = hookCount ? `${hookCount} hooks` : ''
    const sep = hooksLabel ? ' · ' : ''
    console.log(`  ${label}${toolCount} tools${sep}${hooksLabel}${reset}`)
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
  const width = cols - 2
  console.log(`\x1b[90m${'·'.repeat(width)}\x1b[0m`)
}

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max'

export interface StatusLineInfo {
  model: string
  provider: string
  mode: 'yolo' | 'auto' | 'plan'
  /** Current context utilization percentage (0-100), from TokenBudgetManager */
  contextPct: number
  /** Model context window size in tokens */
  contextWindow: number
  /** Current estimated context tokens (history) */
  contextTokens: number
  /** Cumulative total tokens consumed across all turns */
  totalTokens: number
  /** Cumulative input tokens */
  inputTokens?: number
  /** Cumulative output tokens */
  outputTokens?: number
  /** Estimated session cost in USD */
  costUsd?: number
  /** Output tokens per second (latest turn) */
  tokPerSec?: number
  cwd: string
  gitBranch?: string
  effort?: ThinkingEffort
}

/**
 * Print the status line below the separator, above the prompt.
 * Shows: model · context bar · project · git branch · tokens · mode
 *
 * Context % comes from TokenBudgetManager.getBudget() — not estimated here.
 */
export function printStatusLine(info: StatusLineInfo): void {
  const cols = process.stdout.columns || 80

  // Context bar — driven by budget data, not local estimation
  const pct = Math.min(100, info.contextPct)
  const barLen = 8
  const filled = Math.round((pct / 100) * barLen)
  const empty = barLen - filled
  let barColor = '\x1b[32m'  // green
  if (pct >= 60) barColor = '\x1b[31m'       // red
  else if (pct >= 50) barColor = '\x1b[33m'  // yellow (orange tier)
  else if (pct >= 40) barColor = '\x1b[33m'  // yellow
  // Overflow indicator: when context is at capacity
  const overflowMark = info.contextPct >= 95 ? '\x1b[31;1m!\x1b[0m' : ''
  const bar = `${barColor}${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m${overflowMark}`

  // Git branch
  const gitPart = info.gitBranch ? ` \x1b[90mgit:(\x1b[32m${info.gitBranch}\x1b[90m)\x1b[0m` : ''

  // Project name (last directory component)
  const project = info.cwd.split('/').filter(Boolean).pop() || '~'

  // Mode (Shift+Tab to cycle)
  const modeColors: Record<string, string> = {
    yolo: '\x1b[33m', auto: '\x1b[36m', plan: '\x1b[32m',
  }
  const modeColor = modeColors[info.mode] || '\x1b[90m'
  const modeTag = `${modeColor}▸▸ ${info.mode}${RST}`

  // Thinking effort indicator — compact single symbol
  const effortDisplay: Record<ThinkingEffort, string> = {
    low:    '\x1b[90mlow\x1b[0m',
    medium: '\x1b[33mmed\x1b[0m',
    high:   '\x1b[36mhigh\x1b[0m',
    max:    '\x1b[35mmax\x1b[0m',
  }
  const effort = info.effort || 'high'
  const effortTag = effortDisplay[effort]

  // Model short
  const modelShort = info.model.length > 20 ? info.model.slice(0, 18) + '..' : info.model

  // Context tokens display: "12K / 200K" format
  const fmtK = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1000)}K` : String(n)
  const ctxStr = `${fmtK(info.contextTokens)}/${fmtK(info.contextWindow)}`

  // Cost display
  const costStr = info.costUsd && info.costUsd > 0 ? ` ${theme.dim}|${RST} ${formatCost(info.costUsd)}` : ''

  // Tok/s display
  const tpsStr = info.tokPerSec && info.tokPerSec > 0 ? ` ${theme.dim}${Math.round(info.tokPerSec)} tok/s${RST}` : ''

  // Cumulative token display: input/output split + total
  const tokenParts: string[] = []
  if (info.inputTokens && info.outputTokens) {
    tokenParts.push(`\x1b[90min:${fmtK(info.inputTokens)} out:${fmtK(info.outputTokens)}\x1b[0m`)
  }
  tokenParts.push(`\x1b[90mtotal\x1b[0m ${info.totalTokens.toLocaleString()}`)
  const tokenStr = tokenParts.join(' ')

  // Line 1: ◇ ORCA | model | ████░░░░ 15% (12K/200K) | project git:(branch)
  const left1 = `${theme.accent}◇${RST} \x1b[1;37mORCA${RST} ${theme.dim}|${RST} ${modelShort} ${theme.dim}|${RST} ${bar} ${pct}% ${theme.dim}(${ctxStr})${RST} ${theme.dim}|${RST} ${theme.accent}${project}${RST}${gitPart}`
  console.log(`${left1}`)

  // Line 2: ▸▸ yolo | high | $0.42 · 38 tok/s           in:1.2M out:234K total:1.4M
  const left2 = `${modeTag} \x1b[90m|\x1b[0m ${effortTag}${costStr}${tpsStr}`
  // Strip ANSI for width calculation
  const plainLeft2 = left2.replace(/\x1b\[[0-9;]*m/g, '')
  const plainToken = tokenStr.replace(/\x1b\[[0-9;]*m/g, '')
  const pad = Math.max(1, cols - plainLeft2.length - plainToken.length - 1)
  console.log(`${left2}${' '.repeat(pad)}${tokenStr}`)
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
  private readonly workFrames = ['◐', '◓', '◑', '◒']
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

  /** Add streamed text with CJK-aware token estimation */
  addText(text: string): void {
    // CJK chars: ~1.5 chars/token; Latin: ~4 chars/token
    let cjk = 0
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) ||
          (code >= 0xFF00 && code <= 0xFFEF) || (code >= 0x3000 && code <= 0x303F)) {
        cjk++
      }
    }
    const latin = text.length - cjk
    this.tokenCount += Math.ceil(cjk / 1.5 + latin / 4)
  }

  /** Legacy: add raw character count (Latin-only estimation) */
  addChars(n: number): void {
    this.tokenCount += Math.ceil(n / 4)
  }

  private render(): void {
    const elapsed = formatElapsed(Date.now() - this.startTime)
    const frames = this.phase === 'thinking' ? this.thinkFrames : this.workFrames
    const frame = frames[this.spinIdx % frames.length]!
    this.spinIdx++

    // Show "esc to interrupt" only for first 5 seconds, then just "esc"
    const age = Date.now() - this.startTime
    const hint = age < 5000 ? 'esc to interrupt' : 'esc'

    let line: string
    if (this.phase === 'thinking') {
      line = `  ${frame} Thinking... (${elapsed} • ${hint})`
    } else {
      // Token count already CJK-aware from addText()
      const tokStr = this.tokenCount > 0 ? ` · ↓ ${this.tokenCount.toLocaleString()} tokens` : ''
      line = `  ${frame} Working (${elapsed}${tokStr} • ${hint})`
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
  const durationMs = startTime ? Date.now() - startTime : 0
  const durationStr = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
  if (timerKey) toolTimers.delete(timerKey)

  const icon = success ? chalk.green('  ✓') : chalk.red('  ✗')
  const timeStr = chalk.gray(` ${durationStr}`)

  // Show result preview — inline diff for edits, compact summary for others
  if (output) {
    if ((toolName === 'edit_file' || toolName === 'multi_edit') && success) {
      printInlineDiff(output)
    } else {
      const preview = getResultPreview(toolName, output)
      if (preview) {
        const previewColor = success ? chalk.gray : chalk.yellow
        console.log(previewColor(`  │ ${preview}`))
      }
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
      return truncate(String(args.command || ''), 100)
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
      return `${lines.length} lines read`
    }
    case 'list_directory': {
      const entries = output.split('\n').filter(Boolean)
      return `${entries.length} entries`
    }
    case 'run_command': {
      const lines = output.split('\n').filter(Boolean)
      if (lines.length <= 3) return lines.map(l => truncate(l, 100)).join(' | ')
      const first = truncate(lines[0]!, 80)
      return `${first} ... (${lines.length} lines)`
    }
    case 'search_files': {
      const matches = output.split('\n').filter(Boolean)
      return matches.length > 0 && output !== 'No matches found.'
        ? `${matches.length} matches`
        : 'no matches'
    }
    case 'write_file':
      return truncate(output, 80)
    case 'edit_file':
      return truncate(output, 80)
    case 'glob_files': {
      const files = output.split('\n').filter(Boolean)
      return `${files.length} files`
    }
    default:
      return ''
  }
}

/**
 * Print a compact inline diff for edit_file results.
 * Shows +/- lines with color: green for additions, red for deletions, gray for context.
 * Folds long diffs to keep output compact.
 */
function printInlineDiff(output: string): void {
  const lines = output.split('\n')
  const MAX_DIFF_LINES = 12

  // Parse diff-like output: lines starting with + or - or containing "→"
  const diffLines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }> = []
  for (const line of lines) {
    if (line.startsWith('+')) diffLines.push({ type: 'add', text: line })
    else if (line.startsWith('-')) diffLines.push({ type: 'del', text: line })
    else if (line.startsWith('@@') || line.startsWith('diff ')) continue // skip headers
    else if (line.trim()) diffLines.push({ type: 'ctx', text: line })
  }

  // If output doesn't look like a diff, show as compact preview
  if (diffLines.length === 0) {
    const preview = truncate(output, 80)
    if (preview) console.log(chalk.gray(`  │ ${preview}`))
    return
  }

  // Show diff lines with folding
  const showLines = diffLines.length > MAX_DIFF_LINES
    ? [...diffLines.slice(0, 5), { type: 'ctx' as const, text: `... ${diffLines.length - 10} lines hidden ...` }, ...diffLines.slice(-5)]
    : diffLines

  for (const dl of showLines) {
    const prefix = '  │ '
    const text = dl.text.slice(0, 100) + (dl.text.length > 100 ? '...' : '')
    switch (dl.type) {
      case 'add': console.log(`${prefix}\x1b[32m${text}\x1b[0m`); break
      case 'del': console.log(`${prefix}\x1b[31m${text}\x1b[0m`); break
      case 'ctx': console.log(`${prefix}\x1b[90m${text}\x1b[0m`); break
    }
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
    parts.push(formatCost(cost))
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

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(2)}`
  // Sub-cent: show in cents for readability
  const cents = usd * 100
  return `${cents.toFixed(1)}c`
}
