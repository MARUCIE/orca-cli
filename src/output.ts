/**
 * Forge CLI output formatting.
 *
 * Supports two modes:
 *   - streaming (interactive terminal): real-time token output with spinners
 *   - json (CI/headless): NDJSON event stream for machine consumption
 */

import chalk from 'chalk'

export type OutputMode = 'streaming' | 'json'

// ── Banner ──────────────────────────────────────────────────────────

const VERSION = '0.1.0'

// Anvil with sparks — the forge where tools are made
// Each line is padded to exactly 20 visible chars for alignment
const ART_WIDTH = 20 // visible character width of art column
const ANVIL_ART = [
  '\x1b[33m     · ✦ ·\x1b[0m',          //  10 vis chars
  '\x1b[36m   ▄██████▄\x1b[0m',          //  11 vis chars
  '\x1b[36m  ██████████\x1b[0m',          //  12 vis chars
  '\x1b[36m  ▀████████▀\x1b[0m',          //  12 vis chars
  '\x1b[36m    ██████\x1b[0m',            //  10 vis chars
  '\x1b[36m   ████████\x1b[0m',           //  11 vis chars
]
// Visible widths of each art line (excluding ANSI codes)
const ART_VIS_WIDTHS = [10, 11, 12, 12, 10, 11]

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

/**
 * Rich startup banner with ASCII art anvil, model info, and project context.
 */
export function printRichBanner(opts: {
  provider: string
  model: string
  cwd: string
  configFiles?: string[]
  toolCount?: number
  mode?: 'yolo' | 'safe'
}): void {
  const { provider, model, cwd, configFiles, toolCount, mode } = opts
  const spec = getModelSpec(model)
  const shortCwd = abbreviatePath(cwd)

  // Build right-side info lines (aligned with art)
  const modeTag = mode === 'yolo' ? `  \x1b[33m[yolo]\x1b[0m` : mode === 'safe' ? `  \x1b[32m[safe]\x1b[0m` : ''
  const info: string[] = [
    '',  // sparks line — no text
    `\x1b[1;37mForge\x1b[0m  \x1b[90mv${VERSION}\x1b[0m`,
    `\x1b[90marmature agent runtime\x1b[0m`,
    '',  // spacer
    `\x1b[36m▸\x1b[0m \x1b[90m${provider}/\x1b[0m\x1b[1;37m${model}\x1b[0m` + (spec ? `  \x1b[90m${spec}\x1b[0m` : '') + modeTag,
    `\x1b[36m▸\x1b[0m \x1b[90m${shortCwd}\x1b[0m`,
  ]

  // Print art + info side by side with consistent padding
  const pad = ' '.repeat(ART_WIDTH)
  console.log()
  for (let i = 0; i < ANVIL_ART.length; i++) {
    const artLine = ANVIL_ART[i]!
    const visWidth = ART_VIS_WIDTHS[i] || 0
    const gap = ' '.repeat(Math.max(0, ART_WIDTH - visWidth))
    const infoLine = info[i] || ''
    if (infoLine) {
      console.log(`${artLine}${gap}${infoLine}`)
    } else {
      console.log(artLine)
    }
  }

  // Extra info below the art (aligned with info column)
  const extras: string[] = []
  if (configFiles && configFiles.length > 0) {
    extras.push(`\x1b[90mconfig: ${configFiles.join(', ')}\x1b[0m`)
  }
  if (toolCount) {
    extras.push(`\x1b[90m${toolCount} tools · 8 hooks\x1b[0m`)
  }
  for (const line of extras) {
    console.log(`${pad}${line}`)
  }
  console.log()
}

/** Simple banner for non-interactive / one-shot mode */
export function printBanner(toolCount?: number): void {
  const tools = toolCount ? `${toolCount} tools` : 'multi-model'
  console.log(chalk.blue.bold(`\n  forge`) + chalk.gray(` v${VERSION}`) + chalk.gray(` — armature agent runtime`))
  console.log(chalk.gray(`  provider-neutral · ${tools}\n`))
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
  console.error(chalk.red.bold(`  error: `) + chalk.red(classified.message))
  if (classified.suggestion) {
    console.error(chalk.yellow(`  hint: ${classified.suggestion}`))
  }
}

export function printWarning(message: string): void {
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
      suggestion: 'Check your API key. Set ARMATURE_API_KEY or POE_API_KEY environment variable.',
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
 */
export function printSeparator(): void {
  const cols = process.stdout.columns || 80
  console.log(chalk.gray('─'.repeat(Math.min(cols - 2, 80))))
}

export interface StatusLineInfo {
  model: string
  provider: string
  mode: 'yolo' | 'safe'
  contextChars: number
  totalTokens: number
  cwd: string
  gitBranch?: string
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

  // Model short
  const modelShort = info.model.length > 20 ? info.model.slice(0, 18) + '..' : info.model

  // Tokens right-aligned
  const tokenStr = `${info.totalTokens.toLocaleString()} tokens`

  // Left side
  const left = `\x1b[36m◇\x1b[0m \x1b[1;37mFORGE\x1b[0m \x1b[90m│\x1b[0m ${modelShort} \x1b[90m│\x1b[0m ${bar} ${pct}% \x1b[90m│\x1b[0m \x1b[36m${project}\x1b[0m${gitPart}`

  // Print status line
  console.log(`${left}`)
  console.log(`${modeTag} \x1b[90m(--safe to change)\x1b[0m${' '.repeat(Math.max(0, cols - 40 - tokenStr.length))}\x1b[90m${tokenStr}\x1b[0m`)
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
