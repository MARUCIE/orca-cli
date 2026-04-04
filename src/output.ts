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

export function printBanner(): void {
  const version = '0.1.0'
  console.log(chalk.blue.bold(`\n  forge`) + chalk.gray(` v${version}`) + chalk.gray(` — armature agent runtime`))
  console.log(chalk.gray(`  provider-neutral · 50 tools · MCP-native\n`))
}

export function printProviderInfo(provider: string, model: string): void {
  console.log(
    chalk.gray('  ') +
    chalk.cyan('▸') +
    chalk.gray(` ${provider}`) +
    chalk.gray('/') +
    chalk.white.bold(model) +
    '\n'
  )
}

export function printProjectContext(cwd: string, configFiles: string[]): void {
  console.log(chalk.gray(`  cwd: ${cwd}`))
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

export function resetOutputState(): void {
  lastWasNewline = true
}

export function setLastNewline(value: boolean): void {
  lastWasNewline = value
}

// ── Live Progress (Claude Code style status line) ───────────────────

let progressInterval: ReturnType<typeof setInterval> | null = null
let progressStartTime = 0
let progressTokens = 0

export function startProgress(): void {
  progressStartTime = Date.now()
  progressTokens = 0
}

export function updateProgressTokens(count: number): void {
  progressTokens += count
}

export function stopProgress(): void {
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
}

// ── Tool Use Display (Claude Code style) ────────────────────────────

const toolTimers = new Map<string, number>()
let toolCallCount = 0

export function resetToolCallCount(): void {
  toolCallCount = 0
}

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
  // Convert snake_case to PascalCase display
  switch (name) {
    case 'read_file': return 'Read'
    case 'write_file': return 'Write'
    case 'list_directory': return 'ListDir'
    case 'run_command': return 'Bash'
    case 'search_files': return 'Search'
    default: return name
  }
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
      return output
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
  console.log(chalk.gray(`\n  ─ ${parts.join(' · ')} ─\n`))
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
