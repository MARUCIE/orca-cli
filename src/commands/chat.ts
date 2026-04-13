/**
 * `orca chat` — Interactive or one-shot agent conversation.
 *
 * Usage:
 *   orca chat "your prompt"       — one-shot query with streaming output
 *   orca chat                      — interactive REPL mode with multi-turn history
 *   orca chat --json "prompt"     — NDJSON output for CI/pipelines
 */

import { Command } from 'commander'
import { execSync } from 'node:child_process'
import { basename } from 'node:path'
import type { OrcaConfig } from '../config.js'
import { resolveConfig, resolveProvider, getGlobalConfigPath, listProviders, initProjectConfig } from '../config.js'
import { existsSync, appendFileSync, mkdirSync as fsMkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  printRichBanner, printBanner, printProviderInfo, printProjectContext, printError,
  streamToken, ensureNewline, setLastNewline, printToolUse, printToolResult,
  printUsageSummary, printSessionSummary, emitJson,
  askPermission, printDiffPreview,
  printSeparator, printStatusLine,
  ProgressIndicator, theme,
} from '../output.js'
import type { OutputMode } from '../output.js'
import { streamChat } from '../providers/openai-compat.js'
import type { ChatMessage } from '../providers/openai-compat.js'
import { StreamMarkdown } from '../markdown.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { hooks } from '../hooks.js'
import type { HookInput } from '../hooks.js'
import { mcpClient } from '../mcp-client.js'
import { runCommandPicker } from '../command-picker.js'
import { runCouncil, runRace, runPipeline, pickDiverseModels } from '../multi-model.js'
import type { PipelineStage } from '../multi-model.js'
import { TOOL_DEFINITIONS, executeTool, DANGEROUS_TOOLS } from '../tools.js'
import { autoVerify, formatVerifyOutput } from '../auto-verify.js'
import { TokenBudgetManager } from '../token-budget.js'
import { RetryTracker } from '../retry-intelligence.js'
import { recordUsage } from '../usage-db.js'
import { consumeCompletedBackgroundJobs, listBackgroundJobs, readBackgroundJobLog } from '../background-jobs.js'
import { formatContextWindow, formatPricing, getAgenticWarning, getContextWindowForModel, getPricingForModel, listModelChoices, type ModelChoice } from '../model-catalog.js'
import { logInfo, logWarning } from '../logger.js'
import { ContextMonitor, LoopDetector, classifyError } from '../harness/index.js'
import { ModeRegistry } from '../modes/index.js'
import { ThreadManager } from '../memory/threads.js'
import { matchCognitive, formatCognitiveContext } from '../cognitive-skeleton.js'
import { PostmortemLog, NotesManager, PromptRepository, LearningJournal } from '../knowledge/index.js'

interface ChatOptions {
  model?: string
  provider?: string
  apiKey?: string
  maxTurns?: string
  systemPrompt?: string
  json?: boolean
  cwd?: string
  safe?: boolean
  effort?: string
  continue?: boolean
}

export function createChatCommand(): Command {
  return new Command('chat')
    .description('Start an agent conversation')
    .argument('[prompt...]', 'Prompt text (omit for interactive mode)')
    .option('-m, --model <model>', 'Model name (e.g., claude-sonnet-4-20250514, gpt-4.1)')
    .option('-p, --provider <provider>', 'Provider (anthropic, openai, google, poe, auto)')
    .option('-k, --api-key <key>', 'API key (overrides env)')
    .option('--max-turns <n>', 'Maximum agent turns', '25')
    .option('-s, --system-prompt <prompt>', 'System prompt')
    .option('--json', 'Output as NDJSON for CI/pipelines')
    .option('--cwd <dir>', 'Working directory')
    .option('--safe', 'Enable permission prompts for dangerous tools (default: yolo)')
    .option('--effort <level>', 'Thinking effort: low, medium, high (default), max')
    .option('-c, --continue', 'Resume the most recent saved session')
    .action(async (promptParts: string[], opts: ChatOptions) => {
      const prompt = promptParts.join(' ').trim()
      const outputMode: OutputMode = opts.json ? 'json' : 'streaming'

      try {
        const config = resolveConfig({
          cwd: opts.cwd || process.cwd(),
          flags: buildFlags(opts),
        })

        const resolved = resolveProvider(config)

        const cwd = opts.cwd || process.cwd()

        if (outputMode === 'streaming') {
          if (prompt) {
            // One-shot mode: compact banner
            printBanner(TOOL_DEFINITIONS.length)
            printProviderInfo(resolved.provider, resolved.model)
            const startupWarning = getAgenticWarning(resolved.model)
            if (startupWarning) {
              console.log(`\x1b[33m  model caution: ${resolved.model} — ${startupWarning}\x1b[0m\n`)
              logWarning('model caution', { model: resolved.model, provider: resolved.provider, warning: startupWarning })
            }
          } else {
            // Interactive REPL: load hooks early so banner can show actual count
            hooks.load(cwd)
            const configFiles = detectConfigFiles(cwd)
            await printRichBanner({
              provider: resolved.provider,
              model: resolved.model,
              cwd,
              configFiles: configFiles.length > 0 ? configFiles : undefined,
              toolCount: TOOL_DEFINITIONS.length,
              hookCount: hooks.totalHooks || undefined,
              mode: opts.safe ? 'auto' : 'yolo',
            })
          }
        }

        if (prompt) {
          await executeOneShot(prompt, resolved, config, outputMode, cwd)
        } else {
          await runREPL(resolved, config, outputMode, cwd, { safe: opts.safe, effort: opts.effort, continue: opts.continue })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (outputMode === 'json') {
          emitJson({ type: 'error', error: message })
        } else {
          printError(message)
        }
        process.exit(1)
      }
    })
}

// ── Types ───────────────────────────────────────────────────────

interface ResolvedProvider {
  provider: string
  apiKey: string
  model: string
  baseURL?: string
  sdkProvider: 'anthropic' | 'openai'
}

interface SessionStats {
  turns: number
  totalInputTokens: number
  totalOutputTokens: number
  startTime: number
}

// ── One-shot Mode ───────────────────────────────────────────────

async function executeOneShot(
  prompt: string,
  resolved: ResolvedProvider,
  config: OrcaConfig,
  outputMode: OutputMode,
  cwd: string,
): Promise<void> {
  if (resolved.baseURL) {
    await runProxyQuery({ prompt, resolved, config, outputMode, cwd })
  } else {
    await runSDKQuery({ prompt, resolved, config, outputMode, cwd })
  }
}

// ── Interactive REPL ────────────────────────────────────────────

const GOODBYE_MESSAGES = [
  'Goodbye!', 'See you!', 'Catch you later!', 'Happy building!', 'bye.',
]

async function runREPL(
  resolved: ResolvedProvider,
  config: OrcaConfig,
  outputMode: OutputMode,
  cwd: string,
  opts: { safe?: boolean; effort?: string; continue?: boolean } = {},
): Promise<void> {
  const { createInterface } = await import('node:readline')
  const { homedir: getHomedir } = await import('node:os')

  // Enable input history (up/down arrow) with persistent file
  const historyFile = join(getHomedir(), '.orca', 'repl_history')
  let savedHistory: string[] = []
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    if (existsSync(historyFile)) {
      savedHistory = readFileSync(historyFile, 'utf-8').trim().split('\n').filter(Boolean).slice(-100)
    }
  } catch { /* ignore */ }

  // Tab completion for slash commands
  const SLASH_COMMANDS = [
    // Session
    '/help', '/clear', '/compact', '/status', '/cost', '/doctor',
    // Model
    '/model', '/models', '/providers', '/effort',
    // Context
    '/history', '/tokens', '/stats', '/system',
    // Session management
    '/save', '/load', '/sessions', '/continue',
    // Git workflow
    '/diff', '/git', '/commit', '/review', '/pr', '/undo',
    // Multi-model
    '/council', '/race', '/pipeline',
    // System
    '/config', '/init', '/hooks', '/mcp', '/jobs', '/cwd', '/mode', '/thread', '/threads',
    // Knowledge
    '/notes', '/postmortem', '/prompts', '/learn',
    // Exit
    '/exit', '/quit', '/retry',
  ]
  const completer = (line: string): [string[], string] => {
    if (line.startsWith('/')) {
      const hits = SLASH_COMMANDS.filter(c => c.startsWith(line))
      return [hits.length ? hits : SLASH_COMMANDS, line]
    }
    return [[], line]
  }

  // Prevent MaxListenersExceededWarning from repeated close listeners
  process.stdin.setMaxListeners(20)
  process.stdout.setMaxListeners(20)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    history: savedHistory,
    historySize: 100,
    completer,
  })

  // Ctrl+L to clear screen + live slash hint
  let lastHintLen = 0
  rl.on('SIGCONT', () => { /* resume after bg */ })
  rl.on('line', () => { lastHintLen = 0 }) // clear hint state on submit

  // Keyboard shortcuts
  process.stdin.on('keypress', (_ch: string, key: { name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean; sequence?: string }) => {
    // Ctrl+L: clear screen
    if (key && key.ctrl && key.name === 'l') {
      process.stdout.write('\x1b[2J\x1b[H')
      rl.prompt()
      return
    }

    // Shift+Tab: cycle permission mode (yolo → auto → plan → yolo)
    if (key && key.name === 'tab' && key.shift) {
      const idx = PERM_MODES.indexOf(currentPermMode)
      currentPermMode = PERM_MODES[(idx + 1) % PERM_MODES.length]!
      const modeColors: Record<PermMode, string> = {
        yolo: '\x1b[33m', auto: '\x1b[36m', plan: '\x1b[32m',
      }
      process.stderr.write(`\r\x1b[2K${modeColors[currentPermMode]}  mode: ${currentPermMode}\x1b[0m\n`)
      rl.prompt(true)
      return
    }

    // Ctrl+Z: quick undo (same as /undo)
    if (key && key.ctrl && key.name === 'z') {
      if (lastWrite?.path) {
        const { path: undoPath, oldContent } = lastWrite
        try {
          if (oldContent === null) {
            unlinkSync(undoPath)
            process.stderr.write(`\r\x1b[2K\x1b[90m  undo: deleted ${undoPath}\x1b[0m\n`)
          } else {
            writeFileSync(undoPath, oldContent, 'utf-8')
            process.stderr.write(`\r\x1b[2K\x1b[90m  undo: restored ${undoPath}\x1b[0m\n`)
          }
          lastWrite = { path: '', oldContent: null }
        } catch { /* ignore */ }
      }
      return
    }

    // Slash command hint: when user types exactly '/', show all commands
    const line = (rl as unknown as { line: string }).line
    if (line === '/' && lastHintLen === 0) {
      // Print command menu below the prompt (no cursor tricks — works in all terminals)
      const cols = process.stdout.columns || 80
      const cmdsPerRow = Math.floor(cols / 16)
      const rows: string[] = []
      for (let i = 0; i < SLASH_COMMANDS.length; i += cmdsPerRow) {
        rows.push(SLASH_COMMANDS.slice(i, i + cmdsPerRow).map(c => `\x1b[36m${c.padEnd(15)}\x1b[0m`).join(' '))
      }
      process.stdout.write(`\n${rows.join('\n')}\n\x1b[90m  tab to complete · type to filter\x1b[0m\n`)
      lastHintLen = 1
    }
  })

  let stdinEnded = false
  rl.on('close', () => { stdinEnded = true })

  // Multi-turn conversation history
  const history: ChatMessage[] = []
  let sysPrompt = config.systemPrompt || buildSystemPrompt(cwd)

  // Effort-based system prompt modification
  const effortPrefix: Record<string, string> = {
    low: 'Be concise. Give brief answers.\n\n',
    high: 'Think carefully and thoroughly before answering.\n\n',
    max: 'Use deep analysis. Consider all edge cases. Think step by step.\n\n',
  }
  const effortLevel = opts.effort || 'high'
  if (effortPrefix[effortLevel]) {
    sysPrompt = effortPrefix[effortLevel] + sysPrompt
  }

  history.push({ role: 'system', content: sysPrompt })

  // Session statistics
  const stats: SessionStats = {
    turns: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startTime: Date.now(),
  }

  // Session resume: --continue flag loads most recent session
  if (opts.continue) {
    const { getLastSession } = await import('./session.js')
    const last = getLastSession()
    if (last) {
      history.length = 0
      history.push(...last.session.history.map((m: { role: string; content: string }) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })))
      stats.turns = last.session.stats?.turns || 0
      stats.totalInputTokens = last.session.stats?.inputTokens || 0
      stats.totalOutputTokens = last.session.stats?.outputTokens || 0
      console.log(`\x1b[90m  Resuming session: ${last.name} (${stats.turns} turns, ${history.length} messages)\x1b[0m`)
    } else {
      console.log(`\x1b[90m  no saved sessions found — starting fresh.\x1b[0m`)
    }
  }

  const homeDir = getHomedir()
  const dirName = cwd === homeDir ? '~' : basename(cwd)

  // Mutable model (supports /model set)
  let currentModel = resolved.model
  let lastPrompt = '' // for /retry
  let currentEffort: import('../output.js').ThinkingEffort =
    (opts.effort as import('../output.js').ThinkingEffort) || 'high'

  // Permission mode: yolo (auto-approve all) → auto (approve safe, prompt dangerous) → plan (prompt all)
  type PermMode = 'yolo' | 'auto' | 'plan'
  const PERM_MODES: PermMode[] = ['yolo', 'auto', 'plan']
  let currentPermMode: PermMode = opts.safe ? 'auto' : 'yolo'

  // SOTA agent intelligence modules
  const tokenBudget = new TokenBudgetManager(currentModel)
  const retryTracker = new RetryTracker(2)
  const contextMonitor = new ContextMonitor(getContextWindowForModel(currentModel) || 200_000)
  const loopDetector = new LoopDetector()
  const modeRegistry = new ModeRegistry()

  // Load custom modes from .orca/modes.json if present
  const customModesPath = join(cwd, '.orca', 'modes.json')
  if (existsSync(customModesPath)) {
    try {
      modeRegistry.loadFromFile(customModesPath)
    } catch { /* ignore malformed modes file */ }
  }

  const threadManager = new ThreadManager()

  const shortModel = (m: string) => m.length > 24 ? m.slice(0, 22) + '..' : m
  const getChoices = (): ModelChoice[] => listModelChoices(config, currentModel)

  // Get git branch (cached)
  let gitBranch: string | undefined
  try {
    const { execSync: execSyncImport } = await import('node:child_process')
    gitBranch = execSyncImport('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf-8' }).trim() || undefined
  } catch { /* not a git repo */ }

  // Track last turn's output speed for tok/s display
  let lastTokPerSec = 0

  const renderStatusAndPrompt = (): string => {
    const budget = tokenBudget.getBudget(history)
    const totalTokens = stats.totalInputTokens + stats.totalOutputTokens

    // Estimate session cost from cumulative tokens
    const pricing = getPricingForModel(currentModel)
    let costUsd = 0
    if (pricing) {
      costUsd = (stats.totalInputTokens / 1_000_000) * pricing[0]
             + (stats.totalOutputTokens / 1_000_000) * pricing[1]
    }

    printSeparator()
    printStatusLine({
      model: currentModel,
      provider: resolved.provider,
      mode: currentPermMode,
      contextPct: budget.utilizationPct,
      contextWindow: budget.contextWindow,
      contextTokens: budget.historyTokensEst,
      totalTokens,
      inputTokens: stats.totalInputTokens,
      outputTokens: stats.totalOutputTokens,
      costUsd,
      tokPerSec: lastTokPerSec,
      cwd,
      gitBranch,
      effort: currentEffort,
    })

    return `${theme.prompt}❯\x1b[0m `
  }

  const promptUser = (): Promise<string | null> => new Promise((resolve) => {
    if (stdinEnded) { resolve(null); return }
    const promptStr = renderStatusAndPrompt()
    rl.question(promptStr, (answer) => resolve(answer.trim()))
    rl.once('close', () => resolve(null))
  })

  // Load hooks and MCP servers
  hooks.load(cwd)
  if (hooks.totalHooks > 0) {
    hooks.printStatus()
  }

  mcpClient.loadConfigs(cwd)
  if (mcpClient.configuredCount > 0) {
    const connected = await mcpClient.connectAll()
    if (connected.length > 0) {
      console.log(`\x1b[90m  MCP: ${connected.length} server(s) connected (${connected.join(', ')})\x1b[0m`)
    }
  }

  await hooks.run('SessionStart', { event: 'SessionStart', cwd, model: currentModel })
  logInfo('chat session started', { cwd, model: currentModel, provider: resolved.provider })

  // ── Provider preflight check ──
  if (resolved.baseURL) {
    try {
      const { chatOnce } = await import('../providers/openai-compat.js')
      const probe = await Promise.race([
        chatOnce({ apiKey: resolved.apiKey, baseURL: resolved.baseURL, model: resolved.model, maxTokens: 1 }, 'ping'),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ])
      if (probe) {
        console.log(`\x1b[32m  provider: ${resolved.provider}/${resolved.model} — connected\x1b[0m`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`\x1b[33m  provider: ${resolved.provider}/${resolved.model} — ${msg}\x1b[0m`)
      console.log(`\x1b[33m  hint: check proxy/network. Session will continue — requests may fail.\x1b[0m`)
    }
  }

  const startupWarning = getAgenticWarning(currentModel)
  if (startupWarning) {
    console.log(`\x1b[33m  model caution: ${currentModel} — ${startupWarning}\x1b[0m`)
    logWarning('model caution', { model: currentModel, provider: resolved.provider, warning: startupWarning })
  }

  console.log('\x1b[90m  Type your message. /help for commands. Ctrl+C to quit.\x1b[0m')
  console.log('\x1b[90m  /council /race /pipeline — multi-model collaboration\x1b[0m\n')

  // Input history collector for persistence
  const inputHistory: string[] = []

  // Undo stack: track last write_file for /undo
  let lastWrite: { path: string; oldContent: string | null } | null = null

  // Periodic auto-save interval (every 5 turns or 3 minutes)
  let lastAutoSave = Date.now()
  const AUTO_SAVE_INTERVAL_MS = 3 * 60 * 1000

  while (true) {
    // Periodic auto-save for crash recovery
    if (stats.turns > 0 && (Date.now() - lastAutoSave > AUTO_SAVE_INTERVAL_MS)) {
      autoSaveSession(currentModel, history, stats)
      lastAutoSave = Date.now()
    }

    const completedJobs = consumeCompletedBackgroundJobs()
    for (const job of completedJobs) {
      const status = job.status === 'completed' ? '\x1b[32mcompleted\x1b[0m' : '\x1b[31mfailed\x1b[0m'
      const exitText = typeof job.exitCode === 'number' ? `exit ${job.exitCode}` : 'no exit code'
      console.log(`\x1b[90m  background job ${job.id}\x1b[0m ${status} \x1b[90m(${exitText})\x1b[0m`)
      console.log(`\x1b[90m  command: ${job.command.slice(0, 100)}${job.command.length > 100 ? '...' : ''}\x1b[0m`)
      console.log(`\x1b[90m  log: ${job.logPath}\x1b[0m`)
      const tail = readBackgroundJobLog(job, 6)
      if (tail) {
        console.log(`\x1b[90m  tail:\n${tail.slice(0, 800)}\x1b[0m`)
      }
      logInfo('background job notification surfaced', { id: job.id, status: job.status, exitCode: job.exitCode ?? null })
      console.log()
    }

    let input = await promptUser()

    if (input === null) break
    if (!input) continue

    // Multi-line input: ``` opens fence mode
    if (input.startsWith('```')) {
      const lines: string[] = [input]
      const multiPrompt = (): Promise<string | null> => new Promise((resolve) => {
        if (stdinEnded) { resolve(null); return }
        rl.question('\x1b[90m  ...\x1b[0m ', (answer) => resolve(answer))
        rl.once('close', () => resolve(null))
      })
      while (true) {
        const line = await multiPrompt()
        if (line === null) break
        lines.push(line)
        if (line.trim() === '```') break
      }
      input = lines.join('\n')
    }

    // ── Crash-safe turn boundary: uncaught errors here don't kill the session ──
    try {

    // Shell mode: !command executes directly (like Amp's $ prefix)
    if (input.startsWith('!') && input.length > 1) {
      const shellCmd = input.slice(1).trim()
      if (shellCmd) {
        try {
          const result = execSync(shellCmd, {
            cwd, encoding: 'utf-8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          if (result.trim()) {
            console.log(`\x1b[90m${result.slice(0, 5000)}\x1b[0m`)
            if (result.length > 5000) console.log('\x1b[90m  ... (truncated)\x1b[0m')
          }
        } catch (err) {
          const execErr = err as { stdout?: string; stderr?: string; message: string; status?: number }
          const output = execErr.stderr || execErr.stdout || execErr.message
          console.log(`\x1b[31m${output.slice(0, 2000)}\x1b[0m`)
        }
      }
      continue
    }

    // Slash command dispatch
    if (input.startsWith('/')) {
      // Interactive command picker: just `/` alone opens the picker
      if (input === '/') {
        const picked = await runCommandPicker()
        if (picked) {
          input = picked
          // Fall through to process the picked command
        } else {
          continue // cancelled
        }
      }

      // Handle /effort: change thinking intensity
      if (input.startsWith('/effort')) {
        const level = input.replace('/effort', '').trim().toLowerCase()
        const valid = ['low', 'medium', 'med', 'high', 'max'] as const
        if (!level) {
          console.log(`\x1b[90m  effort: ${currentEffort}. Options: low, medium, high, max\x1b[0m`)
          continue
        }
        const mapped = level === 'med' ? 'medium' : level
        if (['low', 'medium', 'high', 'max'].includes(mapped)) {
          const old = currentEffort
          currentEffort = mapped as import('../output.js').ThinkingEffort
          console.log(`\x1b[90m  effort: ${old} → \x1b[36m${currentEffort}\x1b[0m`)
        } else {
          console.log(`\x1b[33m  invalid effort. Options: low, medium, high, max\x1b[0m`)
        }
        continue
      }

      // Handle /mode: switch behavioral profiles
      if (input.startsWith('/mode')) {
        const modeArg = input.replace('/mode', '').trim().toLowerCase()
        if (!modeArg) {
          const active = modeRegistry.getActive()
          const modes = modeRegistry.listModes()
          console.log(`\x1b[90m  Active mode: \x1b[36m${active.id}\x1b[0m\x1b[90m (${active.name})\x1b[0m`)
          console.log('\x1b[90m  Available modes:\x1b[0m')
          for (const mode of modes) {
            const marker = mode.id === active.id ? ' \x1b[36m<-\x1b[0m' : ''
            console.log(`\x1b[90m    ${mode.id.padEnd(14)} ${mode.description}${marker}\x1b[0m`)
          }
          continue
        }
        if (modeRegistry.switchTo(modeArg)) {
          const mode = modeRegistry.getActive()
          // Rebuild system prompt with mode prefix
          const sysIdx = history.findIndex(m => m.role === 'system')
          if (sysIdx >= 0) {
            const basePrompt = history[sysIdx]!.content
              .replace(/^You are in \w+ mode\.[^\n]*\n*/m, '') // strip old mode prefix
            history[sysIdx] = {
              role: 'system',
              content: mode.systemPromptPrefix
                ? mode.systemPromptPrefix + '\n\n' + basePrompt
                : basePrompt,
            }
          }
          console.log(`\x1b[90m  mode: \x1b[36m${mode.id}\x1b[0m\x1b[90m (${mode.name})\x1b[0m`)
          if (mode.tools) {
            console.log(`\x1b[90m  tools restricted to: ${mode.tools.join(', ')}\x1b[0m`)
          }
        } else {
          console.log(`\x1b[33m  unknown mode: ${modeArg}. Use /mode to list.\x1b[0m`)
        }
        continue
      }

      // Handle /retry specially
      if (input === '/retry' || input === '/r') {
        if (!lastPrompt) {
          console.log('\x1b[90m  nothing to retry.\x1b[0m')
          continue
        }
        console.log(`\x1b[90m  retrying: ${lastPrompt.slice(0, 60)}${lastPrompt.length > 60 ? '...' : ''}\x1b[0m`)
        // Remove last user+assistant pair from history
        while (history.length > 0 && history[history.length - 1]!.role !== 'system') {
          const last = history[history.length - 1]!
          if (last.role === 'assistant' || last.role === 'user') {
            history.pop()
          } else break
          if (last.role === 'user') break
        }
        // Fall through to execute lastPrompt
      } else {
        const handled = handleSlashCommand(input, resolved, history, stats, cwd, {
          getModel: () => currentModel,
          setModel: (m: string) => {
            currentModel = m
            resolved.model = m
            // Re-resolve provider if the model family changed and we're not on an aggregator
            const providerConfig = config.providers[resolved.provider]
            if (!providerConfig?.aggregator) {
              try {
                const newResolved = resolveProvider({ ...config, defaultModel: m })
                resolved.provider = newResolved.provider
                resolved.apiKey = newResolved.apiKey
                if (newResolved.baseURL) resolved.baseURL = newResolved.baseURL
              } catch { /* keep current provider if re-resolve fails */ }
            }
          },
          getProvider: () => resolved.provider,
          getChoices,
        }, { lastWrite }, { tokenBudget, contextMonitor }, modeRegistry, threadManager)
        if (handled === 'exit') {
          saveInputHistory(historyFile, inputHistory)
          mcpClient.disconnectAll()
          await hooks.run('SessionEnd', { event: 'SessionEnd', cwd, model: currentModel })
          // Auto-save session on clean exit (if there was any conversation)
          if (stats.turns > 0) {
            autoSaveSession(currentModel, history, stats)
          }
          printSessionSummary({
            turns: stats.turns,
            totalInputTokens: stats.totalInputTokens,
            totalOutputTokens: stats.totalOutputTokens,
            durationMs: Date.now() - stats.startTime,
            model: currentModel,
          })
          recordUsage({
            provider: resolved.provider,
            model: currentModel,
            inputTokens: stats.totalInputTokens,
            outputTokens: stats.totalOutputTokens,
            costUsd: computeCost(currentModel, stats.totalInputTokens, stats.totalOutputTokens),
            durationMs: Date.now() - stats.startTime,
            turns: stats.turns,
            command: 'chat',
            cwd,
          })
          logInfo('chat session ended', {
            cwd,
            model: currentModel,
            provider: resolved.provider,
            turns: stats.turns,
            inputTokens: stats.totalInputTokens,
            outputTokens: stats.totalOutputTokens,
          })
          const bye = GOODBYE_MESSAGES[Math.floor(Math.random() * GOODBYE_MESSAGES.length)]
          console.log(`\x1b[90m  ${bye}\x1b[0m`)
          break
        }
        if (handled === 'pick_model') {
          // Wait for number input to select model
          const pick = await promptUser()
          if (pick === null) break
          const num = parseInt(pick, 10)
          const choices = getChoices()
          if (num >= 1 && num <= choices.length) {
            const oldModel = currentModel
            currentModel = choices[num - 1]!.model
            resolved.model = currentModel
            console.log(`\x1b[90m  model: ${oldModel} → \x1b[36m${currentModel}\x1b[0m`)
            const warning = getAgenticWarning(currentModel)
            if (warning) console.log(`\x1b[33m  model caution: ${warning}\x1b[0m`)
            logInfo('model switched via picker', { from: oldModel, to: currentModel, provider: resolved.provider })
            if (warning) logWarning('model caution', { model: currentModel, provider: resolved.provider, warning })
          } else if (pick) {
            console.log('\x1b[33m  invalid selection. Use 1-' + choices.length + '.\x1b[0m')
          }
          continue
        }
        if (handled === 'handled') continue

        // Multi-model commands — route each model to its provider
        if ((handled as string) === 'council' || (handled as string) === 'race' || (handled as string) === 'pipeline') {
          const mmPrompt = input.replace(/^\/(council|race|pipeline)\s*/, '').trim()
          if (!mmPrompt) continue

          // Import routing functions
          const { resolveModelEndpoint, findAggregator } = await import('../config.js')
          const aggId = findAggregator(config)
          const resolveEndpoint = (m: string) => resolveModelEndpoint(m, config, aggId)

          if ((handled as string) === 'council') {
            const candidates = pickDiverseModels(3)
            // Pre-check: verify endpoints exist before calling
            const available = candidates.filter(m => resolveEndpoint(m) !== null)
            const unavailable = candidates.filter(m => resolveEndpoint(m) === null)
            if (available.length === 0) {
              console.log(`\x1b[31m  council: no models with available endpoints.\x1b[0m`)
              console.log(`\x1b[33m  tried: ${candidates.join(', ')}\x1b[0m`)
              console.log(`\x1b[33m  hint: set multiple API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)`)
              console.log(`        or configure an aggregator provider (poe, openrouter) in .orca.json\x1b[0m\n`)
              continue
            }
            if (unavailable.length > 0) {
              console.log(`\x1b[33m  note: ${unavailable.join(', ')} unavailable (no endpoint), using ${available.length} models\x1b[0m`)
            }
            const models = available
            console.log(`\n\x1b[36m  ╭── Council: ${models.length} models ──╮\x1b[0m`)
            models.forEach(m => {
              const ep = resolveEndpoint(m)
              console.log(`\x1b[90m  │ ${m} → ${ep?.provider || '?'}\x1b[0m`)
            })
            const result = await runCouncil({
              prompt: mmPrompt, models, judgeModel: models[0]!, resolveEndpoint,
              onModelStart: (m) => process.stdout.write(`\x1b[90m  ● ${m}...\x1b[0m`),
              onModelDone: (m, ms) => console.log(` \x1b[32m${(ms/1000).toFixed(1)}s\x1b[0m`),
            })
            console.log()
            for (const r of result.responses) {
              if (r.error) { console.log(`\x1b[31m  ✗ ${r.model}: ${r.error}\x1b[0m`) }
              else { console.log(`\x1b[90m  ── ${r.model} (${(r.durationMs/1000).toFixed(1)}s) ──\x1b[0m\n  ${r.text.slice(0, 500)}${r.text.length > 500 ? '...' : ''}\n`) }
            }
            console.log(`\x1b[36m  ★ Verdict\x1b[0m \x1b[90m(${result.verdict.model}, ${(result.verdict.durationMs/1000).toFixed(1)}s)\x1b[0m\n  ${result.verdict.text}\n`)
            console.log(`\x1b[90m  ─ ${result.responses.length} models · ${(result.totalDurationMs/1000).toFixed(1)}s · agreement: ${result.agreement} ─\x1b[0m\n`)

          } else if ((handled as string) === 'race') {
            const candidates = pickDiverseModels(5)
            const models = candidates.filter(m => resolveEndpoint(m) !== null)
            if (models.length === 0) {
              console.log(`\x1b[31m  race: no models with available endpoints. Set multiple API keys.\x1b[0m\n`)
              continue
            }
            console.log(`\n\x1b[33m  ╭── Race: ${models.length} models ──╮\x1b[0m`)
            const result = await runRace({
              prompt: mmPrompt, models, resolveEndpoint,
              onModelStart: (m) => process.stdout.write(`\x1b[90m  ◎ ${m}...\x1b[0m`),
              onModelDone: (m, ms, won) => console.log(won ? ` \x1b[32m★ WINNER ${(ms/1000).toFixed(1)}s\x1b[0m` : ` \x1b[90m${(ms/1000).toFixed(1)}s\x1b[0m`),
            })
            console.log(`\n\x1b[32m  Winner: ${result.winner.model} (${(result.winner.durationMs/1000).toFixed(1)}s)\x1b[0m\n  ${result.winner.text}\n`)
            if (result.cancelled.length > 0) console.log(`\x1b[90m  cancelled: ${result.cancelled.join(', ')}\x1b[0m`)
            console.log(`\x1b[90m  ─ ${(result.totalDurationMs/1000).toFixed(1)}s total ─\x1b[0m\n`)

          } else if ((handled as string) === 'pipeline') {
            const stages: PipelineStage[] = [
              { role: 'plan', model: 'claude-opus-4.6' },
              { role: 'code', model: 'gpt-5.4' },
              { role: 'review', model: 'gemini-3.1-pro' },
            ]
            console.log(`\n\x1b[35m  ╭── Pipeline: ${stages.length} stages ──╮\x1b[0m`)
            const result = await runPipeline({
              prompt: mmPrompt, stages, resolveEndpoint,
              onStageStart: (s, i) => process.stdout.write(`\x1b[90m  ${i+1}. ${s.role} (${s.model})...\x1b[0m`),
              onStageDone: (_s, _i, ms) => console.log(` \x1b[32m${(ms/1000).toFixed(1)}s\x1b[0m`),
            })
            console.log()
            for (const { stage, response } of result.stages) {
              console.log(`\x1b[90m  ── ${stage.role} · ${response.model} (${(response.durationMs/1000).toFixed(1)}s) ──\x1b[0m`)
              if (response.error) { console.log(`\x1b[31m  error: ${response.error}\x1b[0m\n`) }
              else { console.log(`  ${response.text.slice(0, 800)}${response.text.length > 800 ? '...' : ''}\n`) }
            }
            console.log(`\x1b[90m  ─ ${result.stages.length} stages · ${(result.totalDurationMs/1000).toFixed(1)}s total ─\x1b[0m\n`)
          }
          continue
        }

        // 'not_command' falls through to treat as normal message
      }
    }

    const messageToSend = (input === '/retry' || input === '/r') ? lastPrompt : input
    if (!messageToSend) continue

    lastPrompt = messageToSend
    inputHistory.push(messageToSend)

    // UserPromptSubmit hook
    if (hooks.hasHooks('UserPromptSubmit')) {
      const hookResult = await hooks.run('UserPromptSubmit', { event: 'UserPromptSubmit', prompt: messageToSend, cwd })
      if (!hookResult.continue) {
        console.log(`\x1b[33m  hook blocked prompt: ${hookResult.stopReason || ''}\x1b[0m`)
        continue
      }
    }

    // Cognitive skeleton: match prompt → inject thinking framework
    const cogMatch = matchCognitive(messageToSend)
    if (cogMatch) {
      const cogCtx = formatCognitiveContext(cogMatch)
      // Inject as system-level context so the model applies the framework
      history.push({ role: 'system', content: cogCtx })
      process.stderr.write(`\x1b[90m  [cognitive] ${cogMatch.scenario}: ${cogMatch.models.map(m => m.name).join(', ')}\x1b[0m\n`)
    }

    // Pre-send context guard: compact BEFORE API call if too large
    const preBudget = tokenBudget.getBudget(history)
    if (preBudget.utilizationPct >= 75) {
      const compactResult = tokenBudget.smartCompact(history)
      if (compactResult.dropped > 0) {
        process.stderr.write(`\x1b[33m  [auto-compact] ${compactResult.summary}\x1b[0m\n`)
      }
      // If still over 90% after compact, warn but try anyway
      const postBudget = tokenBudget.getBudget(history)
      if (postBudget.utilizationPct >= 90) {
        process.stderr.write(`\x1b[31m  [warn] context still at ${postBudget.utilizationPct}% after compact — API call may fail\x1b[0m\n`)
      }
    }

    // Abort controller for Esc/Ctrl+C during generation
    const abortController = new AbortController()

    // Listen for Esc key (0x1b) to interrupt generation
    const rawMode = process.stdin.isTTY
    if (rawMode) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
    }
    const escHandler = (data: Buffer) => {
      const key = data[0]
      if (key === 0x1b || key === 0x03) { // Esc or Ctrl+C
        abortController.abort()
        if (rawMode) {
          process.stdin.setRawMode(false)
          process.stdin.removeListener('data', escHandler)
        }
        ensureNewline()
        console.log('\x1b[90m  [interrupted]\x1b[0m')
      }
    }
    if (rawMode) {
      process.stdin.on('data', escHandler)
    }

    // Progress indicator (thinking → working with elapsed time + token count)
    const progress = new ProgressIndicator()
    let firstToken = false
    progress.start()

    try {
      if (resolved.baseURL && !abortController.signal.aborted) {
        const result = await runProxyTurn({
          prompt: messageToSend,
          resolved,
          config,
          outputMode,
          history,
          cwd,
          abortSignal: abortController.signal,
          onFirstToken: () => {
            firstToken = true
            const { elapsed } = progress.stop()
            if (elapsed > 1000) {
              process.stdout.write(`\x1b[90m  [${(elapsed / 1000).toFixed(1)}s to first token]\x1b[0m\n`)
            }
            progress.start()
            progress.markWorking()
          },
          onStreamToken: (text: string) => {
            progress.addText(text)
          },
          onFileWrite: (path, oldContent) => { lastWrite = { path, oldContent } },
          safeMode: currentPermMode !== 'yolo',
          retryTracker,
          loopDetector,
          tokenBudget,
          contextMonitor,
        })
        stats.turns++
        stats.totalInputTokens += result.inputTokens
        stats.totalOutputTokens += result.outputTokens
        tokenBudget.recordUsage(result.inputTokens, result.outputTokens)
        contextMonitor.recordUsage(result.inputTokens, result.outputTokens)

        // Track tok/s from this turn (output tokens / generation time)
        const turnElapsed = progress.stop().elapsed
        if (turnElapsed > 0 && result.outputTokens > 0) {
          lastTokPerSec = result.outputTokens / (turnElapsed / 1000)
        }

        // Harness: context utilization warning with actionable detail
        const risk = contextMonitor.getRiskLevel()
        if (risk !== 'green') {
          const snap = contextMonitor.getSnapshot()
          const pct = (snap.utilization * 100).toFixed(1)
          const fmtK = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1000)}K` : String(n)
          const detail = `${fmtK(snap.inputTokens)}/${fmtK(snap.modelWindow)}`
          if (risk === 'red') {
            process.stderr.write(`\x1b[31m  [harness] context ${pct}% RED (${detail}) — run /clear now\x1b[0m\n`)
          } else if (risk === 'orange') {
            process.stderr.write(`\x1b[33m  [harness] context ${pct}% ORANGE (${detail}) — run /compact\x1b[0m\n`)
          } else if (risk === 'yellow') {
            process.stderr.write(`\x1b[33m  [harness] context ${pct}% YELLOW (${detail}) — consider /compact\x1b[0m\n`)
          }
        }
      } else if (!abortController.signal.aborted) {
        firstToken = true
        progress.stop()
        await runSDKQuery({ prompt: messageToSend, resolved, config, outputMode, cwd })
        stats.turns++
      }
    } catch (err) {
      progress.stop()
      if (!abortController.signal.aborted) {
        const errMsg = err instanceof Error ? err.message : String(err)
        // Auto-recover from 413 (context too large): compact and retry once
        if (errMsg.includes('413') || errMsg.includes('context_length') || errMsg.includes('too large')) {
          process.stderr.write(`\x1b[33m  [auto-recovery] context overflow detected, compacting and retrying...\x1b[0m\n`)
          const compact = tokenBudget.smartCompact(history, 1) // aggressive: keep only 1 turn
          if (compact.dropped > 0) {
            process.stderr.write(`\x1b[33m  [auto-compact] ${compact.summary}\x1b[0m\n`)
            // Reset context monitor after aggressive compact
            contextMonitor.reset()
          }
        } else {
          printError(errMsg)
        }
      }
    } finally {
      progress.stop()
      if (rawMode) {
        process.stdin.setRawMode(false)
        process.stdin.removeListener('data', escHandler)
      }
    }
    console.log()

    // ── Auto-compact: smart context management via TokenBudgetManager ──
    const budget = tokenBudget.getBudget(history)
    const msgCount = history.filter(m => m.role !== 'system').length

    if (budget.risk === 'red') {
      hooks.run('PreCompact', { event: 'PreCompact', cwd })
      const result = tokenBudget.smartCompact(history, 1)
      hooks.run('PostCompact', { event: 'PostCompact', cwd })
      console.log(`\x1b[31m  auto-compact (${budget.utilizationPct}% · ${msgCount} msgs): ${result.summary}\x1b[0m`)
      retryTracker.cleanup()
    } else if (budget.risk === 'orange') {
      hooks.run('PreCompact', { event: 'PreCompact', cwd })
      const result = tokenBudget.smartCompact(history, 2)
      hooks.run('PostCompact', { event: 'PostCompact', cwd })
      console.log(`\x1b[33m  auto-compact (${budget.utilizationPct}% · ${msgCount} msgs): ${result.summary}\x1b[0m`)
    } else if (budget.risk === 'yellow') {
      console.log(`\x1b[33m  context: ${budget.utilizationPct}% · ${msgCount} msgs — /compact to free space\x1b[0m`)
    } else if (msgCount >= 6) {
      // Show context info after first few turns so user knows the system is tracking
      console.log(`\x1b[90m  context: ${budget.utilizationPct}% · ${msgCount} msgs · auto-compact at 40%\x1b[0m`)
    }

    } catch (turnErr) {
      // ── Crash-safe: catch ANY uncaught error in this turn, log it, continue REPL ──
      const msg = turnErr instanceof Error ? turnErr.message : String(turnErr)
      console.error(`\x1b[31m  turn error: ${msg}\x1b[0m`)
      console.error(`\x1b[90m  session continues — type /clear to reset if state is corrupted.\x1b[0m`)
      // Auto-save on error for recovery
      if (stats.turns > 0) {
        autoSaveSession(currentModel, history, stats)
      }
    }
  }

  // Save history on any exit path
  saveInputHistory(historyFile, inputHistory)
  rl.close()
}

function saveInputHistory(historyFile: string, entries: string[]): void {
  if (entries.length === 0) return
  try {
    fsMkdirSync(dirname(historyFile), { recursive: true })
    appendFileSync(historyFile, entries.join('\n') + '\n', 'utf-8')
  } catch { /* ignore write errors */ }
}

function autoSaveSession(model: string, history: ChatMessage[], stats: SessionStats): void {
  try {
    const sessDir = join(process.env.HOME || '/tmp', '.orca', 'sessions')
    fsMkdirSync(sessDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const sessFile = join(sessDir, `auto-${ts}.json`)
    writeFileSync(sessFile, JSON.stringify({
      model,
      history,
      stats: { turns: stats.turns, inputTokens: stats.totalInputTokens, outputTokens: stats.totalOutputTokens },
      savedAt: new Date().toISOString(),
    }, null, 2), 'utf-8')
    console.log(`\x1b[90m  session auto-saved: auto-${ts}\x1b[0m`)
  } catch { /* ignore */ }
}

// ── Slash Commands ──────────────────────────────────────────────

interface ModelControl {
  getModel: () => string
  setModel: (m: string) => void
  getProvider: () => string
  getChoices: () => ModelChoice[]
}

interface UndoState {
  lastWrite: { path: string; oldContent: string | null } | null
}

function handleSlashCommand(
  input: string,
  resolved: ResolvedProvider,
  history: ChatMessage[],
  stats: SessionStats,
  cwd: string,
  mc: ModelControl,
  undo?: UndoState,
  harness?: { tokenBudget: TokenBudgetManager; contextMonitor: ContextMonitor },
  modeRegistry?: ModeRegistry,
  threadManager?: ThreadManager,
): 'exit' | 'handled' | 'pick_model' | 'not_command' {
  const parts = input.split(/\s+/)
  const cmd = parts[0]!.toLowerCase()
  const arg = parts.slice(1).join(' ').trim()

  switch (cmd) {
    case '/exit':
    case '/quit':
    case '/q':
      return 'exit'

    case '/help':
    case '/h':
    case '/?': {
      const d = '\x1b[90m', b = '\x1b[1m', r = '\x1b[0m'
      const row = (l: string, ri: string) => `${d}  ${l.padEnd(38)}${ri}${r}`
      console.log()
      console.log(`${d}  ${b}Session${r}${d}                                ${b}Model${r}`)
      console.log(row('/clear    Clear history',          '/model    Show/switch model'))
      console.log(row('/compact  Keep last 2 turns',      '/models   List all models'))
      console.log(row('/status   Session overview',       '/mode     Behavioral profiles'))
      console.log(row('/cost     Token cost breakdown',   '/effort   Thinking: low/med/high/max'))
      console.log(row('/save     Save session',           '/providers List providers'))
      console.log()
      console.log(`${d}  ${b}Git${r}${d}                                    ${b}Multi-Model${r}`)
      console.log(row('/diff     Show git diff',          '/council  N models + judge'))
      console.log(row('/commit   Create commit',          '/race     First answer wins'))
      console.log(row('/undo     Revert last write',      '/pipeline Plan-Code-Review'))
      console.log(row('/git      Run git command',        '/thread   Conversation memory'))
      console.log()
      console.log(`${d}  ${b}Knowledge${r}${d}                                ${b}System${r}`)
      console.log(row('/notes    Observations + tags',    '/mcp      MCP servers'))
      console.log(row('/postmortem Error patterns',       '/hooks    Registered hooks'))
      console.log(row('/prompts  Template library',       '/doctor   Health check'))
      console.log(row('/learn    Auto-evolution rules',   '/mode     Behavioral profiles'))
      console.log()
      console.log(`${d}  ${b}Tips${r}`)
      console.log(row('!cmd      Shell command',          'Ctrl+L    Clear screen'))
      console.log(row('Tab       Auto-complete',          'Ctrl+Z    Undo last write'))
      console.log(row('/         Command picker',         'Shift+Tab Mode cycle'))
      console.log(r)
      return 'handled'
    }

    case '/model':
    case '/m':
      if (arg.startsWith('set ') || arg.startsWith('use ')) {
        const newModel = arg.replace(/^(set|use)\s+/, '').trim()
        if (!newModel) {
          console.log('\x1b[33m  usage: /model set <name>  (e.g., /model set GPT-4o)\x1b[0m')
          return 'handled'
        }
        const oldModel = mc.getModel()
        mc.setModel(newModel)
        console.log(`\x1b[90m  model: ${oldModel} → \x1b[36m${newModel}\x1b[0m \x1b[90m(${mc.getProvider()})\x1b[0m`)
        const warning = getAgenticWarning(newModel)
        if (warning) console.log(`\x1b[33m  caution: ${warning}\x1b[0m`)
        logInfo('model switched via command', { from: oldModel, to: newModel, provider: mc.getProvider() })
        if (warning) logWarning('model caution', { model: newModel, provider: mc.getProvider(), warning })
        return 'handled'
      }
      {
        const current = mc.getChoices().find((choice) => choice.model === mc.getModel())
        console.log(`\x1b[90m  provider: ${mc.getProvider()}  model: \x1b[36m${mc.getModel()}\x1b[0m`)
        if (current) {
          console.log(`\x1b[90m  context: ${formatContextWindow(current.contextWindow)}  max out: ${formatContextWindow(current.maxOutput)}  pricing: ${formatPricing(current.pricing)} per 1M in/out\x1b[0m`)
          if (current.note) console.log(`\x1b[33m  caution: ${current.note}\x1b[0m`)
        }
      }
      return 'handled'

    case '/models':
      console.log('\x1b[90m  Available models:\x1b[0m')
      for (const [i, choice] of mc.getChoices().entries()) {
        const m = choice.model
        const current = m === mc.getModel()
        const idx = `${i + 1}`.padStart(2)
        const marker = current ? '\x1b[36m' : '\x1b[90m'
        const arrow = current ? ' →' : '  '
        console.log(`${marker}  ${idx}.${arrow} ${m}\x1b[0m`)
        console.log(`\x1b[90m      ${choice.provider} · ${formatContextWindow(choice.contextWindow)} ctx · ${formatPricing(choice.pricing)} per 1M in/out${choice.agentic === 'caution' ? ' · caution' : ''}\x1b[0m`)
      }
      console.log('\x1b[90m  Enter number (1-' + mc.getChoices().length + '):\x1b[0m')
      return 'pick_model'

    case '/clear':
      // Reset conversation + context monitors + clear screen
      {
        const sysMsg = history.find(m => m.role === 'system')
        history.length = 0
        if (sysMsg) history.push(sysMsg)
        stats.turns = 0
        stats.totalInputTokens = 0
        stats.totalOutputTokens = 0
        // Reset BOTH context monitor and token budget to zero
        harness?.contextMonitor.reset()
        harness?.tokenBudget.reset()
        // Clear screen LAST so the new prompt shows on a clean terminal
        process.stdout.write('\x1b[2J\x1b[H')
        console.log('\x1b[90m  conversation cleared.\x1b[0m')
      }
      return 'handled'

    case '/compact':
      // Smart compaction: drop old messages + truncate large ones
      {
        hooks.run('PreCompact', { event: 'PreCompact', cwd })
        if (harness?.tokenBudget) {
          const result = harness.tokenBudget.smartCompact(history)
          if (result.dropped > 0 || result.tokensFreed > 0) {
            console.log(`\x1b[90m  ${result.summary}\x1b[0m`)
            harness.contextMonitor.reset()
          } else {
            console.log(`\x1b[90m  ${result.summary}\x1b[0m`)
          }
        } else {
          // Fallback: naive compaction
          const sysMsg = history.find(m => m.role === 'system')
          const convMsgs = history.filter(m => m.role !== 'system')
          if (convMsgs.length <= 4) {
            console.log(`\x1b[90m  nothing to compact (${convMsgs.length} messages).\x1b[0m`)
          } else {
            const keep = convMsgs.slice(-4)
            const dropped = convMsgs.length - keep.length
            history.length = 0
            if (sysMsg) history.push(sysMsg)
            history.push(...keep)
            console.log(`\x1b[90m  compacted: kept last 2 turns, dropped ${dropped} messages.\x1b[0m`)
          }
        }
        hooks.run('PostCompact', { event: 'PostCompact', cwd })
      }
      return 'handled'

    case '/system':
      if (!arg) {
        const current = history.find(m => m.role === 'system')
        if (current) {
          console.log(`\x1b[90m  system: ${current.content.slice(0, 120)}${current.content.length > 120 ? '...' : ''}\x1b[0m`)
        } else {
          console.log('\x1b[90m  no system prompt set. Usage: /system <prompt>\x1b[0m')
        }
        return 'handled'
      }
      {
        const existingIdx = history.findIndex(m => m.role === 'system')
        if (existingIdx >= 0) {
          history[existingIdx] = { role: 'system', content: arg }
        } else {
          history.unshift({ role: 'system', content: arg })
        }
        console.log(`\x1b[90m  system prompt updated (${arg.length} chars).\x1b[0m`)
      }
      return 'handled'

    case '/history':
      {
        const userMsgs = history.filter(m => m.role === 'user').length
        const assistantMsgs = history.filter(m => m.role === 'assistant').length
        const sysMsgs = history.filter(m => m.role === 'system').length
        const totalChars = history.reduce((sum, m) => sum + m.content.length, 0)
        console.log(`\x1b[90m  ${userMsgs} user + ${assistantMsgs} assistant + ${sysMsgs} system (${totalChars.toLocaleString()} chars)\x1b[0m`)
      }
      return 'handled'

    case '/tokens':
      {
        const totalTokens = stats.totalInputTokens + stats.totalOutputTokens
        console.log('\x1b[90m')
        console.log(`  input:  ${stats.totalInputTokens.toLocaleString()} tokens`)
        console.log(`  output: ${stats.totalOutputTokens.toLocaleString()} tokens`)
        console.log(`  total:  ${totalTokens.toLocaleString()} tokens`)
        console.log('\x1b[0m')
      }
      return 'handled'

    case '/stats': {
      const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0)
      const totalTokens = stats.totalInputTokens + stats.totalOutputTokens
      const historyChars = history.reduce((sum, m) => sum + m.content.length, 0)
      console.log('\x1b[90m')
      console.log(`  model:    ${mc.getModel()}`)
      console.log(`  turns:    ${stats.turns}`)
      console.log(`  tokens:   ${totalTokens.toLocaleString()} (in: ${stats.totalInputTokens.toLocaleString()} / out: ${stats.totalOutputTokens.toLocaleString()})`)
      console.log(`  context:  ${historyChars.toLocaleString()} chars in ${history.length} messages`)
      console.log(`  duration: ${elapsed}s`)
      console.log('\x1b[0m')
      return 'handled'
    }

    case '/cwd':
      console.log(`\x1b[90m  ${cwd}\x1b[0m`)
      return 'handled'

    case '/hooks':
      hooks.printStatus()
      return 'handled'

    case '/council': {
      if (!arg) {
        console.log('\x1b[33m  usage: /council <prompt>  (asks 3 diverse models + judge)\x1b[0m')
        return 'handled'
      }
      // Mark as async — needs to be handled in the REPL loop
      return 'council' as 'handled'
    }

    case '/race': {
      if (!arg) {
        console.log('\x1b[33m  usage: /race <prompt>  (first model to answer wins)\x1b[0m')
        return 'handled'
      }
      return 'race' as 'handled'
    }

    case '/pipeline': {
      if (!arg) {
        console.log('\x1b[33m  usage: /pipeline <prompt>  (plan→code→review chain)\x1b[0m')
        return 'handled'
      }
      return 'pipeline' as 'handled'
    }

    case '/diff': {
      try {
        // execSync imported at top level
        const diff = execSync('git diff --stat && echo "---" && git diff --no-color', {
          cwd, encoding: 'utf-8', timeout: 10_000, maxBuffer: 1024 * 1024,
        })
        if (diff.trim()) {
          console.log(`\x1b[90m${diff.slice(0, 3000)}\x1b[0m`)
          if (diff.length > 3000) console.log('\x1b[90m  ... (truncated)\x1b[0m')
        } else {
          console.log('\x1b[90m  no changes.\x1b[0m')
        }
      } catch (err) {
        console.log(`\x1b[31m  git diff failed: ${err instanceof Error ? err.message : err}\x1b[0m`)
      }
      return 'handled'
    }

    case '/git': {
      if (!arg) {
        console.log('\x1b[33m  usage: /git <command>  (e.g., /git status, /git log --oneline -5)\x1b[0m')
        return 'handled'
      }
      try {
        // execSync imported at top level
        const output = execSync(`git ${arg}`, {
          cwd, encoding: 'utf-8', timeout: 10_000, maxBuffer: 1024 * 1024,
        })
        console.log(`\x1b[90m${output.slice(0, 3000)}\x1b[0m`)
        if (output.length > 3000) console.log('\x1b[90m  ... (truncated)\x1b[0m')
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message: string }
        console.log(`\x1b[31m  ${(execErr.stderr || execErr.stdout || execErr.message).slice(0, 500)}\x1b[0m`)
      }
      return 'handled'
    }

    case '/save': {
      const sessionName = arg || `session-${Date.now()}`
      const sessDir = join(process.env.HOME || '/tmp', '.orca', 'sessions')
      try {
        fsMkdirSync(sessDir, { recursive: true })
        const sessFile = join(sessDir, `${sessionName}.json`)
        writeFileSync(sessFile, JSON.stringify({
          model: mc.getModel(),
          history,
          stats: { turns: stats.turns, inputTokens: stats.totalInputTokens, outputTokens: stats.totalOutputTokens },
          savedAt: new Date().toISOString(),
        }, null, 2), 'utf-8')
        console.log(`\x1b[90m  saved: ${sessFile}\x1b[0m`)
      } catch (err) {
        console.log(`\x1b[31m  save failed: ${err instanceof Error ? err.message : err}\x1b[0m`)
      }
      return 'handled'
    }

    case '/load': {
      if (!arg) {
        console.log('\x1b[33m  usage: /load <name>  (see /sessions for available)\x1b[0m')
        return 'handled'
      }
      const sessDir = join(process.env.HOME || '/tmp', '.orca', 'sessions')
      const sessFile = join(sessDir, arg.endsWith('.json') ? arg : `${arg}.json`)
      try {
        const data = JSON.parse(readFileSync(sessFile, 'utf-8'))
        history.length = 0
        if (Array.isArray(data.history)) {
          for (const m of data.history) history.push(m)
        }
        if (data.model) {
          mc.setModel(data.model)
        }
        stats.turns = data.stats?.turns || 0
        stats.totalInputTokens = data.stats?.inputTokens || 0
        stats.totalOutputTokens = data.stats?.outputTokens || 0
        const msgCount = history.filter(m => m.role !== 'system').length
        console.log(`\x1b[90m  loaded: ${msgCount} messages, model: ${mc.getModel()}\x1b[0m`)
      } catch (err) {
        console.log(`\x1b[31m  load failed: ${err instanceof Error ? err.message : err}\x1b[0m`)
      }
      return 'handled'
    }

    case '/sessions': {
      const sessDir = join(process.env.HOME || '/tmp', '.orca', 'sessions')
      try {
        if (!existsSync(sessDir)) {
          console.log('\x1b[90m  no saved sessions.\x1b[0m')
          return 'handled'
        }
        const files = readdirSync(sessDir).filter(f => f.endsWith('.json')).sort().reverse()
        if (files.length === 0) {
          console.log('\x1b[90m  no saved sessions.\x1b[0m')
          return 'handled'
        }
        console.log('\x1b[90m  Saved sessions:\x1b[0m')
        for (const f of files.slice(0, 10)) {
          const name = f.replace('.json', '')
          try {
            const data = JSON.parse(readFileSync(join(sessDir, f), 'utf-8'))
            const turns = data.stats?.turns || 0
            const savedAt = data.savedAt ? new Date(data.savedAt).toLocaleString() : '?'
            console.log(`\x1b[90m    ${name}\x1b[0m  \x1b[90m${turns} turns · ${savedAt}\x1b[0m`)
          } catch {
            console.log(`\x1b[90m    ${name}\x1b[0m`)
          }
        }
        if (files.length > 10) {
          console.log(`\x1b[90m    ... and ${files.length - 10} more\x1b[0m`)
        }
      } catch {
        console.log('\x1b[90m  no saved sessions.\x1b[0m')
      }
      return 'handled'
    }

    case '/jobs': {
      const jobs = listBackgroundJobs(10)
      if (jobs.length === 0) {
        console.log('\x1b[90m  no background jobs.\x1b[0m')
        return 'handled'
      }
      console.log('\x1b[90m  Background jobs:\x1b[0m')
      for (const job of jobs) {
        const completed = job.completedAt ? ` · ${job.completedAt}` : ''
        const status = job.status === 'completed'
          ? '\x1b[32mcompleted\x1b[0m'
          : job.status === 'failed'
            ? '\x1b[31mfailed\x1b[0m'
            : '\x1b[33mrunning\x1b[0m'
        console.log(`\x1b[90m    ${job.id}\x1b[0m ${status}\x1b[90m${completed}\x1b[0m`)
        console.log(`\x1b[90m      ${job.command.slice(0, 90)}${job.command.length > 90 ? '...' : ''}\x1b[0m`)
      }
      return 'handled'
    }

    case '/undo': {
      if (!undo?.lastWrite) {
        console.log('\x1b[90m  nothing to undo.\x1b[0m')
        return 'handled'
      }
      const { path: undoPath, oldContent } = undo.lastWrite
      try {
        if (oldContent === null) {
          // File was newly created — delete it
          unlinkSync(undoPath)
          console.log(`\x1b[90m  undo: deleted ${undoPath} (was newly created)\x1b[0m`)
        } else {
          // File was overwritten — restore old content
          writeFileSync(undoPath, oldContent, 'utf-8')
          console.log(`\x1b[90m  undo: restored ${undoPath} (${oldContent.length} bytes)\x1b[0m`)
        }
        undo.lastWrite = null
      } catch (err) {
        console.log(`\x1b[31m  undo failed: ${err instanceof Error ? err.message : err}\x1b[0m`)
      }
      return 'handled'
    }

    // ── CC/Codex compatible commands ──────────────────────────────

    case '/cost': {
      const pricing = getPricingForModel(mc.getModel())
      const cost = pricing
        ? (stats.totalInputTokens * pricing[0] + stats.totalOutputTokens * pricing[1]) / 1_000_000
        : 0
      const pricingLabel = pricing ? `$${pricing[0]}/$${pricing[1]} per 1M in/out` : 'pricing unavailable'
      console.log('\x1b[90m  Cost breakdown:\x1b[0m')
      console.log(`\x1b[90m    model:   ${mc.getModel()} (${pricingLabel})\x1b[0m`)
      console.log(`\x1b[90m    input:   ${stats.totalInputTokens.toLocaleString()} tokens\x1b[0m`)
      console.log(`\x1b[90m    output:  ${stats.totalOutputTokens.toLocaleString()} tokens\x1b[0m`)
      console.log(`\x1b[90m    total:   ${(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()} tokens\x1b[0m`)
      const costDisplay = cost >= 0.01 ? `$${cost.toFixed(2)}` : cost > 0 ? `${(cost * 100).toFixed(1)}c` : '$0'
      console.log(`\x1b[90m    cost:    \x1b[36m${costDisplay}\x1b[0m`)
      console.log(`\x1b[90m    turns:   ${stats.turns}\x1b[0m`)
      console.log(`\x1b[90m    time:    ${((Date.now() - stats.startTime) / 1000 / 60).toFixed(1)} min\x1b[0m`)
      return 'handled'
    }

    case '/status': {
      const msgs = history.filter(m => m.role !== 'system').length
      const budget = harness?.tokenBudget.getBudget(history)
      const ctxLine = budget
        ? `${budget.utilizationPct}% (${budget.historyTokensEst.toLocaleString()} / ${budget.contextWindow.toLocaleString()} tokens)`
        : `~${Math.ceil(history.reduce((s, m) => s + m.content.length, 0) / 4).toLocaleString()} tokens (est)`
      console.log('\x1b[90m  Session status:\x1b[0m')
      console.log(`\x1b[90m    provider: \x1b[36m${mc.getProvider()}/${mc.getModel()}\x1b[0m`)
      console.log(`\x1b[90m    turns:    ${stats.turns}\x1b[0m`)
      console.log(`\x1b[90m    messages: ${msgs}\x1b[0m`)
      console.log(`\x1b[90m    context:  ${ctxLine}\x1b[0m`)
      console.log(`\x1b[90m    consumed: ${(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()} tokens (cumulative)\x1b[0m`)
      console.log(`\x1b[90m    cwd:      ${cwd}\x1b[0m`)
      console.log(`\x1b[90m    hooks:    ${hooks.totalHooks}\x1b[0m`)
      console.log(`\x1b[90m    mcp:      ${mcpClient.configuredCount} servers\x1b[0m`)
      return 'handled'
    }

    case '/doctor': {
      console.log('\x1b[90m  Health check:\x1b[0m')
      // Provider
      const provOk = !!resolved.apiKey && !!resolved.baseURL
      console.log(`\x1b[90m    provider: ${provOk ? '\x1b[32mOK\x1b[0m' : '\x1b[31mNO KEY\x1b[0m'} (${resolved.provider})\x1b[0m`)
      // Proxy
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '(system auto-detect)'
      console.log(`\x1b[90m    proxy:    ${proxy}\x1b[0m`)
      // Git
      try {
        execSync('git --version', { stdio: 'pipe' })
        console.log(`\x1b[90m    git:      \x1b[32mOK\x1b[0m`)
      } catch { console.log(`\x1b[90m    git:      \x1b[31mNOT FOUND\x1b[0m`) }
      // Node
      console.log(`\x1b[90m    node:     ${process.version}\x1b[0m`)
      // Hooks
      console.log(`\x1b[90m    hooks:    ${hooks.totalHooks}\x1b[0m`)
      // MCP
      console.log(`\x1b[90m    mcp:      ${mcpClient.configuredCount} configured\x1b[0m`)
      // Tools
      console.log(`\x1b[90m    tools:    ${TOOL_DEFINITIONS.length}\x1b[0m`)
      return 'handled'
    }

    case '/config': {
      console.log(`\x1b[90m  Config files:\x1b[0m`)
      console.log(`\x1b[90m    global: ${getGlobalConfigPath()}\x1b[0m`)
      console.log(`\x1b[90m    project: ${join(cwd, '.orca.json')}\x1b[0m`)
      console.log(`\x1b[90m  Current:\x1b[0m`)
      console.log(`\x1b[90m    provider: ${mc.getProvider()}\x1b[0m`)
      console.log(`\x1b[90m    model:    ${mc.getModel()}\x1b[0m`)
      console.log(`\x1b[90m    mode:     ${undo ? 'yolo' : 'safe'}\x1b[0m`)
      console.log(`\x1b[90m  Edit: orca init (project) or ~/.orca/config.json (global)\x1b[0m`)
      return 'handled'
    }

    case '/continue': {
      // Load most recent auto-saved session
      try {
        const sessDir = join(process.env.HOME || '/tmp', '.orca', 'sessions')
        const files = readdirSync(sessDir).filter(f => f.endsWith('.json')).sort().reverse()
        if (files.length === 0) {
          console.log('\x1b[90m  no saved sessions found.\x1b[0m')
          return 'handled'
        }
        const latest = files[0]!
        const sess = JSON.parse(readFileSync(join(sessDir, latest), 'utf-8'))
        if (sess.history && Array.isArray(sess.history)) {
          history.length = 0
          history.push(...sess.history)
          stats.turns = sess.stats?.turns || 0
          stats.totalInputTokens = sess.stats?.inputTokens || 0
          stats.totalOutputTokens = sess.stats?.outputTokens || 0
          console.log(`\x1b[90m  restored session: ${latest} (${stats.turns} turns, ${history.length} messages)\x1b[0m`)
        }
      } catch (err) {
        console.log(`\x1b[31m  continue failed: ${err instanceof Error ? err.message : err}\x1b[0m`)
      }
      return 'handled'
    }

    case '/commit': {
      try {
        const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000 }).trim()
        if (!status) {
          console.log('\x1b[90m  nothing to commit (working tree clean).\x1b[0m')
        } else {
          // Send as a prompt to the agent: "create a git commit for the current changes"
          return 'not_command' // fall through — let the model handle the commit
        }
      } catch { return 'not_command' }
      return 'handled'
    }

    case '/review': {
      // Fall through to model — treat as prompt "review my current changes"
      return 'not_command'
    }

    case '/pr': {
      // Fall through to model — treat as prompt "create a PR for current changes"
      return 'not_command'
    }

    case '/mcp': {
      // Subcommands: enable <name>, disable <name>, connect <name>
      if (arg.startsWith('disable ')) {
        const serverName = arg.slice(8).trim()
        if (mcpClient.disableServer(serverName)) {
          console.log(`\x1b[90m  disabled: ${serverName}\x1b[0m`)
        } else {
          console.log(`\x1b[31m  server not found: ${serverName}\x1b[0m`)
        }
        return 'handled'
      }
      if (arg.startsWith('enable ')) {
        const serverName = arg.slice(7).trim()
        if (mcpClient.enableServer(serverName)) {
          console.log(`\x1b[90m  enabled: ${serverName}\x1b[0m`)
          // Auto-connect after enable
          mcpClient.connect(serverName).then(ok => {
            if (ok) console.log(`\x1b[32m  connected: ${serverName}\x1b[0m`)
            else console.log(`\x1b[33m  enabled but failed to connect: ${serverName}\x1b[0m`)
          }).catch(() => {})
        } else {
          console.log(`\x1b[31m  server not found: ${serverName}\x1b[0m`)
        }
        return 'handled'
      }
      if (arg.startsWith('connect ')) {
        const serverName = arg.slice(8).trim()
        mcpClient.connect(serverName).then(ok => {
          if (ok) console.log(`\x1b[32m  connected: ${serverName}\x1b[0m`)
          else console.log(`\x1b[31m  failed to connect: ${serverName}\x1b[0m`)
        }).catch(() => {})
        return 'handled'
      }

      const servers = mcpClient.listServers()
      if (servers.length === 0) {
        console.log('\x1b[90m  no MCP servers configured.\x1b[0m')
      } else {
        console.log(`\x1b[90m  MCP servers: ${servers.length} configured, ${mcpClient.connectedCount} connected\x1b[0m`)
        for (const s of servers) {
          const status = s.disabled
            ? '\x1b[90mdisabled\x1b[0m'
            : s.initialized
              ? `\x1b[32mconnected\x1b[0m (pid ${s.pid})`
              : s.pid > 0
                ? '\x1b[33mstarting\x1b[0m'
                : '\x1b[90mnot connected\x1b[0m'
          console.log(`    ${s.name}  ${status}`)
        }
        console.log('\x1b[90m  commands: /mcp enable <name> | disable <name> | connect <name>\x1b[0m')
      }
      return 'handled'
    }

    case '/thread':
    case '/threads': {
      if (!threadManager) {
        console.log('\x1b[90m  thread manager not available.\x1b[0m')
        return 'handled'
      }
      const subcmd = arg.split(/\s+/)[0] || ''
      const subarg = arg.slice(subcmd.length).trim()

      if (!subcmd || subcmd === 'list') {
        const threads = threadManager.list(10)
        if (threads.length === 0) {
          console.log('\x1b[90m  no threads saved.\x1b[0m')
        } else {
          console.log('\x1b[90m  Threads:\x1b[0m')
          for (const t of threads) {
            const msgs = t.messages.length
            const date = new Date(t.updatedAt).toLocaleString()
            console.log(`\x1b[90m    ${t.id}  ${t.title.slice(0, 40)}  (${msgs} msgs · ${date})\x1b[0m`)
          }
        }
      } else if (subcmd === 'save') {
        const title = subarg || `Chat ${new Date().toLocaleString()}`
        const convMsgs = history.filter(m => m.role !== 'system')
        const thread = threadManager.create(title, convMsgs.map(m => ({ role: m.role, content: m.content })))
        console.log(`\x1b[90m  thread saved: ${thread.id} (${thread.title})\x1b[0m`)
      } else if (subcmd === 'load') {
        if (!subarg) {
          console.log('\x1b[33m  usage: /thread load <id>\x1b[0m')
        } else {
          const thread = threadManager.load(subarg)
          if (!thread) {
            console.log(`\x1b[31m  thread not found: ${subarg}\x1b[0m`)
          } else {
            const sysMsg = history.find(m => m.role === 'system')
            history.length = 0
            if (sysMsg) history.push(sysMsg)
            for (const m of thread.messages) {
              history.push({ role: m.role as 'user' | 'assistant', content: m.content })
            }
            console.log(`\x1b[90m  loaded thread: ${thread.title} (${thread.messages.length} messages)\x1b[0m`)
          }
        }
      } else if (subcmd === 'search') {
        if (!subarg) {
          console.log('\x1b[33m  usage: /thread search <query>\x1b[0m')
        } else {
          const results = threadManager.search(subarg, 5)
          if (results.length === 0) {
            console.log(`\x1b[90m  no threads matching "${subarg}".\x1b[0m`)
          } else {
            console.log(`\x1b[90m  Found ${results.length} thread(s):\x1b[0m`)
            for (const t of results) {
              console.log(`\x1b[90m    ${t.id}  ${t.title.slice(0, 40)}\x1b[0m`)
            }
          }
        }
      } else if (subcmd === 'delete') {
        if (!subarg) {
          console.log('\x1b[33m  usage: /thread delete <id>\x1b[0m')
        } else if (threadManager.delete(subarg)) {
          console.log(`\x1b[90m  deleted thread: ${subarg}\x1b[0m`)
        } else {
          console.log(`\x1b[31m  thread not found: ${subarg}\x1b[0m`)
        }
      } else {
        console.log('\x1b[33m  usage: /thread [list|save|load|search|delete]\x1b[0m')
      }
      return 'handled'
    }

    case '/providers': {
      const resolvedConfig = resolveConfig({ cwd })
      const providers = listProviders(resolvedConfig)
      console.log('\x1b[90m  Providers:\x1b[0m')
      for (const p of providers) {
        const status = p.disabled ? '\x1b[90mdisabled\x1b[0m' : p.hasKey ? '\x1b[32mready\x1b[0m' : '\x1b[31mno key\x1b[0m'
        const active = p.id === mc.getProvider() ? ' \x1b[36m←\x1b[0m' : ''
        console.log(`\x1b[90m    ${p.id.padEnd(14)} ${p.model.padEnd(24)} ${status}${active}\x1b[0m`)
      }
      return 'handled'
    }

    case '/init': {
      const configPath = initProjectConfig(cwd)
      console.log(`\x1b[90m  created: ${configPath}\x1b[0m`)
      return 'handled'
    }

    // ── Knowledge Management Commands ──────────────────────────
    case '/notes': {
      const notes = new NotesManager()
      const subcmd = arg.split(/\s+/)[0] || ''
      const subarg = arg.slice(subcmd.length).trim()

      if (!subcmd || subcmd === 'list') {
        const list = notes.list(10)
        if (list.length === 0) { console.log('\x1b[90m  no notes.\x1b[0m') }
        else {
          for (const n of list) {
            const tags = n.tags.length > 0 ? ` [${n.tags.join(', ')}]` : ''
            console.log(`\x1b[90m  ${n.id.slice(0, 20)}  ${n.content.slice(0, 60)}${tags}\x1b[0m`)
          }
        }
      } else if (subcmd === 'add') {
        if (!subarg) { console.log('\x1b[33m  usage: /notes add <content> [#tag1 #tag2]\x1b[0m') }
        else {
          const tags = [...subarg.matchAll(/#(\S+)/g)].map(m => m[1]!)
          const content = subarg.replace(/#\S+/g, '').trim()
          const note = notes.create(content, tags, undefined, cwd.split('/').pop())
          console.log(`\x1b[90m  note saved: ${note.id}\x1b[0m`)
        }
      } else if (subcmd === 'search') {
        const results = notes.search(subarg || '', 5)
        if (results.length === 0) { console.log('\x1b[90m  no matches.\x1b[0m') }
        else { for (const n of results) console.log(`\x1b[90m  ${n.id.slice(0, 20)}  ${n.content.slice(0, 60)}\x1b[0m`) }
      } else {
        console.log('\x1b[33m  usage: /notes [list|add|search]\x1b[0m')
      }
      return 'handled'
    }

    case '/postmortem': {
      const pmLog = new PostmortemLog()
      const subcmd = arg.split(/\s+/)[0] || ''

      if (!subcmd || subcmd === 'list') {
        const list = pmLog.list(10)
        if (list.length === 0) { console.log('\x1b[90m  no postmortems.\x1b[0m') }
        else {
          for (const pm of list) {
            const sev = { low: '\x1b[90m', medium: '\x1b[33m', high: '\x1b[31m', critical: '\x1b[31;1m' }[pm.severity]
            console.log(`${sev}  ${pm.id.slice(0, 16)}  ${pm.problem.slice(0, 50)}  applied:${pm.appliedCount}\x1b[0m`)
          }
        }
      } else if (subcmd === 'search') {
        const query = arg.slice(subcmd.length).trim()
        const matches = pmLog.match(query)
        if (matches.length === 0) { console.log('\x1b[90m  no matches.\x1b[0m') }
        else { console.log(pmLog.formatForContext(matches)) }
      } else {
        console.log('\x1b[33m  usage: /postmortem [list|search <error>]\x1b[0m')
      }
      return 'handled'
    }

    case '/prompts': {
      const repo = new PromptRepository()
      const subcmd = arg.split(/\s+/)[0] || ''
      const subarg = arg.slice(subcmd.length).trim()

      if (!subcmd || subcmd === 'list') {
        const list = repo.list(10)
        if (list.length === 0) { console.log('\x1b[90m  no prompts saved.\x1b[0m') }
        else {
          for (const p of list) {
            const rate = p.usageCount > 0 ? Math.round((p.successCount / p.usageCount) * 100) : 0
            console.log(`\x1b[90m  ${p.name.padEnd(20)} [${p.category}]  used:${p.usageCount} success:${rate}%\x1b[0m`)
          }
        }
      } else if (subcmd === 'find') {
        const found = repo.find(subarg)
        for (const p of found) console.log(`\x1b[90m  ${p.id}  ${p.name}  [${p.category}]\x1b[0m`)
      } else {
        console.log('\x1b[33m  usage: /prompts [list|find <query>]\x1b[0m')
      }
      return 'handled'
    }

    case '/learn': {
      const journal = new LearningJournal()
      const subcmd = arg.split(/\s+/)[0] || ''
      const subarg = arg.slice(subcmd.length).trim()

      if (!subcmd || subcmd === 'rules') {
        const rules = journal.getPromotedRules()
        if (rules.length === 0) { console.log('\x1b[90m  no promoted rules yet.\x1b[0m') }
        else {
          console.log('\x1b[90m  Promoted rules:\x1b[0m')
          for (const r of rules) console.log(`\x1b[32m  + ${r.content.slice(0, 70)}\x1b[0m`)
        }
      } else if (subcmd === 'observe') {
        if (!subarg) { console.log('\x1b[33m  usage: /learn observe <observation>\x1b[0m') }
        else {
          const entry = journal.observe(subarg, [], cwd.split('/').pop())
          console.log(`\x1b[90m  recorded: ${entry.id}\x1b[0m`)
        }
      } else if (subcmd === 'status') {
        const obs = journal.listByStatus('observation').length
        const hyp = journal.listByStatus('hypothesis').length
        const pro = journal.listByStatus('promoted').length
        const rej = journal.listByStatus('rejected').length
        console.log(`\x1b[90m  observations:${obs}  hypotheses:${hyp}  promoted:${pro}  rejected:${rej}\x1b[0m`)
      } else {
        console.log('\x1b[33m  usage: /learn [rules|observe|status]\x1b[0m')
      }
      return 'handled'
    }

    default:
      // Check if it's a model number (e.g., "/1" to "/11")
      if (/^\/\d+$/.test(cmd)) {
        const idx = parseInt(cmd.slice(1), 10) - 1
        const choices = mc.getChoices()
        if (idx >= 0 && idx < choices.length) {
          const newModel = choices[idx]!.model
          const oldModel = mc.getModel()
          mc.setModel(newModel)
          console.log(`\x1b[90m  model: ${oldModel} → \x1b[36m${newModel}\x1b[0m`)
          const warning = getAgenticWarning(newModel)
          if (warning) console.log(`\x1b[33m  caution: ${warning}\x1b[0m`)
          logInfo('model switched via numeric shortcut', { from: oldModel, to: newModel, provider: mc.getProvider() })
          if (warning) logWarning('model caution', { model: newModel, provider: mc.getProvider(), warning })
          return 'handled'
        }
      }
      return 'not_command'
  }
}

// ── Proxy Multi-turn Path ───────────────────────────────────────

interface ProxyTurnOptions {
  prompt: string
  resolved: ResolvedProvider
  config: OrcaConfig
  outputMode: OutputMode
  history: ChatMessage[]
  cwd: string
  abortSignal?: AbortSignal
  onFirstToken?: () => void
  onStreamToken?: (text: string) => void
  onFileWrite?: (path: string, oldContent: string | null) => void
  safeMode?: boolean
  retryTracker?: RetryTracker
  loopDetector?: LoopDetector
  tokenBudget?: TokenBudgetManager
  contextMonitor?: ContextMonitor
}

async function runProxyTurn(options: ProxyTurnOptions): Promise<{ inputTokens: number; outputTokens: number }> {
  const { prompt, resolved, config, outputMode, history, cwd, abortSignal, onFirstToken, onStreamToken, onFileWrite, safeMode, retryTracker, loopDetector, tokenBudget, contextMonitor } = options

  const startTime = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  let responseText = ''
  let gotFirstToken = false
  const md = new StreamMarkdown()

  for await (const event of streamChat(
    { apiKey: resolved.apiKey, baseURL: resolved.baseURL!, model: resolved.model, systemPrompt: config.systemPrompt },
    prompt,
    history,
    {
      onToolCall: async (name, args) => {
        // Permission gate for dangerous tools
        if (DANGEROUS_TOOLS.has(name)) {
          // Track undo state for file writes
          if ((name === 'write_file' || name === 'edit_file' || name === 'multi_edit') && args.path) {
            const { resolve: resolvePath } = await import('node:path')
            const fullPath = resolvePath(cwd, String(args.path))
            let oldContent: string | null = null
            if (existsSync(fullPath)) {
              try { oldContent = readFileSync(fullPath, 'utf-8') } catch { /* ignore */ }
            }
            if (onFileWrite) onFileWrite(fullPath, oldContent)
          }

          // YOLO mode (default): auto-approve, no prompt
          // Safe mode (--safe): show diff + ask permission
          if (safeMode) {
            let preview: string
            if (name === 'write_file') {
              preview = `write ${String(args.content || '').length} bytes to ${String(args.path || '')}`
            } else if (name === 'edit_file' || name === 'multi_edit') {
              preview = `edit ${String(args.path || '')}`
            } else if (name === 'delete_file') {
              preview = `delete ${String(args.path || '')}`
            } else if (name === 'move_file') {
              preview = `move ${String(args.source || '')} → ${String(args.destination || '')}`
            } else if (name === 'git_commit') {
              preview = `commit: ${String(args.message || '').slice(0, 60)}`
            } else if (name === 'run_command' || name === 'run_background') {
              preview = `run: ${String(args.command || '').slice(0, 80)}`
            } else {
              preview = `${name}: ${JSON.stringify(args).slice(0, 80)}`
            }

            // Diff preview for file writes in safe mode
            if ((name === 'write_file' || name === 'edit_file') && args.path) {
              const { resolve: resolvePath } = await import('node:path')
              const fullPath = resolvePath(cwd, String(args.path))
              if (existsSync(fullPath)) {
                try {
                  const old = readFileSync(fullPath, 'utf-8')
                  if (name === 'write_file') printDiffPreview(old, String(args.content || ''))
                  else printDiffPreview(old, old.replace(String(args.old_string || ''), String(args.new_string || '')))
                } catch { /* ignore */ }
              }
            }

            const allowed = await askPermission(name, preview)
            if (!allowed) {
              return { success: false, output: 'User denied permission.' }
            }
          }
        }

        // PreToolUse hook — can block or modify tool input
        if (hooks.hasHooks('PreToolUse')) {
          const hookResult = await hooks.run('PreToolUse', {
            event: 'PreToolUse', toolName: name, toolInput: args, cwd,
          })
          if (!hookResult.continue) {
            return { success: false, output: `Blocked by hook: ${hookResult.stopReason || 'PreToolUse hook denied'}` }
          }
          if (hookResult.updatedInput) {
            Object.assign(args, hookResult.updatedInput)
          }
          if (hookResult.systemMessage) {
            console.log(`\x1b[33m  hook: ${hookResult.systemMessage}\x1b[0m`)
          }
        }

        // Sub-agent tools — fork a child process with restricted tools
        if (name === 'spawn_agent' || name === 'delegate_task') {
          const subTask = String(args.task || args.context || '')
          if (!subTask) return { success: false, output: 'task is required.' }

          await hooks.run('SubagentStart', { event: 'SubagentStart', cwd, model: resolved.model })
          console.log(`\x1b[90m  spawning sub-agent...\x1b[0m`)

          const { spawnSubAgent, READ_ONLY_TOOLS, DELEGATE_TOOLS } = await import('../agent/sub-agent.js')
          const toolSet = name === 'spawn_agent' ? READ_ONLY_TOOLS : DELEGATE_TOOLS
          const result = await spawnSubAgent(
            { task: subTask, cwd, tools: toolSet, timeout: 120_000 },
            { model: resolved.model, apiKey: resolved.apiKey, baseURL: resolved.baseURL || '' },
          )

          console.log(`\x1b[90m  sub-agent done (${(result.duration / 1000).toFixed(1)}s, ${result.tokensUsed} tokens)\x1b[0m`)
          return { success: result.success, output: result.output }

        // ask_user — prompt user for input via readline
        } else if (name === 'ask_user') {
          const question = String(args.question || 'What would you like to do?')
          const options = args.options as string[] | undefined
          console.log(`\n\x1b[36m  ? ${question}\x1b[0m`)
          if (options && options.length > 0) {
            options.forEach((o, i) => console.log(`\x1b[90m    ${i + 1}. ${o}\x1b[0m`))
          }
          const { createInterface } = await import('node:readline')
          const askRl = createInterface({ input: process.stdin, output: process.stdout })
          const answer = await new Promise<string>((res) => {
            askRl.question('\x1b[90m  > \x1b[0m', (a) => { askRl.close(); res(a.trim()) })
          })
          return { success: true, output: answer || '(no response)' }

        // MCP tools — async server communication
        } else if (name === 'mcp_list_resources') {
          try {
            const resources = await mcpClient.listResources(args.server ? String(args.server) : undefined)
            if (resources.length === 0) return { success: true, output: 'No resources available from connected MCP servers.' }
            const lines = resources.map(r => `${r.uri} — ${r.name}${r.description ? ': ' + r.description : ''}`)
            return { success: true, output: lines.join('\n') }
          } catch (err) {
            return { success: false, output: `MCP error: ${err instanceof Error ? err.message : String(err)}` }
          }

        } else if (name === 'mcp_read_resource') {
          const uri = String(args.uri || '')
          if (!uri) return { success: false, output: 'uri is required.' }
          try {
            const content = await mcpClient.readResource(uri)
            return { success: true, output: content.slice(0, 20_000) }
          } catch (err) {
            return { success: false, output: `MCP error: ${err instanceof Error ? err.message : String(err)}` }
          }

        // sleep — actually wait
        } else if (name === 'sleep') {
          const seconds = Math.min(Number(args.seconds) || 1, 60)
          const reason = String(args.reason || '')
          if (reason) console.log(`\x1b[90m  waiting ${seconds}s: ${reason}\x1b[0m`)
          await new Promise(r => setTimeout(r, seconds * 1000))
          return { success: true, output: `Waited ${seconds}s.` }
        }

        const result = executeTool(name, args, cwd)

        // ── Retry intelligence: track success/failure ──
        if (retryTracker) {
          if (result.success) {
            retryTracker.recordSuccess(name, args)
          } else {
            const hint = retryTracker.recordFailure(name, args, result.output)
            if (hint.shouldWarn) {
              result.output += `\n\n${hint.hint}`
            }
          }
        }

        // ── Error classifier: add recovery suggestion ──
        if (!result.success) {
          const classified = classifyError(result.output)
          result.output += `\n[error-classifier] ${classified.category}: ${classified.suggestion}`
          if (classified.retryable) {
            result.output += ` (retryable after ${classified.retryDelay || 0}ms)`
          }
        }

        // ── Loop detector: catch stuck patterns ──
        if (loopDetector) {
          const argsKey = String(args.path || args.pattern || args.command || name)
          if (result.success) {
            loopDetector.recordSuccess(name, argsKey)
          } else {
            const action = loopDetector.recordFailure(name, argsKey, result.output)
            if (action === 'pivot') {
              const suggestion = loopDetector.getPivotSuggestion(name, argsKey)
              result.output += `\n[loop-detector] PIVOT — ${suggestion}`
            } else if (action === 'escalate') {
              result.output += `\n[loop-detector] ESCALATE — this tool has failed 3+ times on the same target. Stop and ask the user for guidance.`
              process.stderr.write(`\x1b[31m  [harness] loop detected: ${name} failed 3+ times — escalating to user\x1b[0m\n`)
            }

            // Postmortem auto-match: search error patterns for known fixes
            try {
              const pmLog = new PostmortemLog()
              const matches = pmLog.match(result.output)
              if (matches.length > 0) {
                const ctx = pmLog.formatForContext(matches)
                result.output += `\n${ctx}`
                process.stderr.write(`\x1b[90m  [postmortem] matched ${matches.length} known fix(es)\x1b[0m\n`)
                for (const m of matches) pmLog.markApplied(m.id)
              }
            } catch { /* postmortem search is best-effort */ }
          }
        }

        // ── Auto-verify: run checks after file modifications ──
        if (result.success && ['write_file', 'edit_file', 'multi_edit'].includes(name) && args.path) {
          const { resolve: resolvePath } = await import('node:path')
          const fullPath = resolvePath(cwd, String(args.path))
          const verifyResult = autoVerify(fullPath, cwd)
          const verifyOutput = formatVerifyOutput(verifyResult)
          if (verifyOutput) {
            result.output += verifyOutput
          }
        }

        // PostToolUse hook — for logging/modification
        if (hooks.hasHooks('PostToolUse')) {
          await hooks.run('PostToolUse', {
            event: 'PostToolUse', toolName: name, toolInput: args,
            toolOutput: result.output, toolSuccess: result.success, cwd,
          })
        }

        // Built-in context guard (mandatory, not user-configurable)
        // Fires after every tool use to prevent context explosion
        if (tokenBudget) {
          const guardBudget = tokenBudget.getBudget(history)
          if (guardBudget.utilizationPct >= 60) {
            const compactResult = tokenBudget.smartCompact(history)
            if (compactResult.dropped > 0) {
              process.stderr.write(`\x1b[33m  [context-guard] auto-compact: ${compactResult.summary}\x1b[0m\n`)
              if (contextMonitor) contextMonitor.reset()
            }
          }
        }

        return result
      },
      abortSignal,
    },
    TOOL_DEFINITIONS as Array<Record<string, unknown>>,
  )) {
    if (outputMode === 'json') {
      emitJson(event as unknown as Record<string, unknown>)
      continue
    }

    switch (event.type) {
      case 'text':
        if (!gotFirstToken && onFirstToken) {
          onFirstToken()
          gotFirstToken = true
        }
        if (event.text) {
          md.push(event.text)
          responseText += event.text
          if (onStreamToken) onStreamToken(event.text)
        }
        break
      case 'tool_use':
        // Flush any buffered markdown before tool output
        md.flush(); setLastNewline(md.endsWithNewline)
        if (!gotFirstToken && onFirstToken) {
          onFirstToken()
          gotFirstToken = true
        }
        printToolUse(event.toolName || 'tool', event.toolInput)
        break
      case 'tool_result':
        printToolResult(event.toolName || 'tool', event.toolSuccess !== false, event.toolOutput)
        break
      case 'usage':
        inputTokens = event.inputTokens || 0
        outputTokens = event.outputTokens || 0
        break
      case 'error':
        md.flush(); setLastNewline(md.endsWithNewline)
        if (!gotFirstToken && onFirstToken) onFirstToken()
        ensureNewline()
        printError(event.error || 'Unknown error')
        break
      case 'done':
        break
    }
  }

  // Flush remaining markdown buffer
  md.flush()

  // Append to conversation history
  history.push({ role: 'user', content: prompt })
  if (responseText) {
    history.push({ role: 'assistant', content: responseText })
  }

  if (outputMode === 'streaming') {
    ensureNewline()
    const contextChars = history.reduce((sum, m) => sum + m.content.length, 0)
    printUsageSummary({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      turns: 1,
      durationMs: Date.now() - startTime,
      model: resolved.model,
      contextChars,
    })
  }

  recordUsage({
    provider: resolved.provider,
    model: resolved.model,
    inputTokens,
    outputTokens,
    costUsd: computeCost(resolved.model, inputTokens, outputTokens),
    durationMs: Date.now() - startTime,
    turns: 1,
    command: 'chat',
  })

  return { inputTokens, outputTokens }
}

// ── One-shot Proxy Path ─────────────────────────────────────────

interface ProxyQueryOptions {
  prompt: string
  resolved: ResolvedProvider
  config: OrcaConfig
  outputMode: OutputMode
}

async function runProxyQuery(options: ProxyQueryOptions & { cwd?: string }): Promise<void> {
  await runProxyTurn({
    ...options,
    history: [],
    cwd: options.cwd || process.cwd(),
  })
}

// ── SDK Agent Loop Path ─────────────────────────────────────────

interface SDKQueryOptions {
  prompt: string
  resolved: ResolvedProvider
  config: OrcaConfig
  outputMode: OutputMode
  cwd: string
}

async function runSDKQuery(options: SDKQueryOptions): Promise<void> {
  const { prompt, resolved, config, outputMode, cwd } = options

  let sdk: { createAgent: (opts: Record<string, unknown>) => { query: (p: string) => AsyncIterable<unknown> } }
  try {
    // @ts-ignore — @orca/sdk is an optional dependency for native provider path
    sdk = await import('@orca/sdk')
  } catch {
    throw new Error('@orca/sdk not installed. Use --provider poe for proxy mode, or npm install @orca/sdk for native mode.')
  }

  // Map CLI provider to SDK provider option
  const sdkProvider = resolved.provider === 'anthropic' ? 'anthropic' : 'openai-compat'

  const agent = sdk.createAgent({
    provider: sdkProvider,
    apiKey: resolved.apiKey,
    model: resolved.model,
    baseURL: resolved.baseURL,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    systemPrompt: config.systemPrompt,
    permissionMode: config.permissionMode as 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | undefined,
    cwd,
  })

  const startTime = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0

  for await (const event of agent.query(prompt)) {
    if (outputMode === 'json') {
      emitJson(event as unknown as Record<string, unknown>)
      continue
    }

    const ev = event as Record<string, unknown>
    const type = ev.type as string | undefined

    if (type === 'text' || type === 'content_block_delta') {
      const text = (ev.text as string) || (ev.delta as Record<string, unknown>)?.text as string || ''
      if (text) streamToken(text)
    } else if (type === 'tool_use' || type === 'tool_call') {
      const toolName = (ev.name as string) || (ev.tool as string) || 'tool'
      let input: string | undefined
      try { input = ev.input ? JSON.stringify(ev.input) : undefined } catch { input = '[complex input]' }
      printToolUse(toolName, input)
    } else if (type === 'result') {
      const result = ev as Record<string, unknown>
      inputTokens = (result.inputTokens as number) || 0
      outputTokens = (result.outputTokens as number) || 0
      turns = (result.turns as number) || 0
    }
  }

  if (outputMode === 'streaming') {
    ensureNewline()
    printUsageSummary({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      turns,
      durationMs: Date.now() - startTime,
    })
  }

  recordUsage({
    provider: resolved.provider,
    model: resolved.model,
    inputTokens,
    outputTokens,
    costUsd: computeCost(resolved.model, inputTokens, outputTokens),
    durationMs: Date.now() - startTime,
    turns,
    command: 'chat-sdk',
  })
}

// ── Cost Computation ───────────────────────────────────────────

/** Compute cost in USD from token counts and model pricing table. */
function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getPricingForModel(model)
  if (!pricing) return 0
  const [inputPer1M, outputPer1M] = pricing
  return (inputTokens * inputPer1M + outputTokens * outputPer1M) / 1_000_000
}

// ── Helpers ─────────────────────────────────────────────────────

function detectConfigFiles(cwd: string): string[] {
  const found: string[] = []
  const candidates = [
    '.orca.json',
    'CLAUDE.md',
    '.claude/settings.json',
    'AGENTS.md',
    '.codex/config.toml',
    'package.json',
  ]
  for (const name of candidates) {
    if (existsSync(join(cwd, name))) {
      found.push(name)
    }
  }
  return found
}

function buildFlags(opts: ChatOptions): Partial<OrcaConfig> {
  const flags: Partial<OrcaConfig> = {}
  if (opts.model) flags.model = opts.model
  if (opts.provider) flags.provider = opts.provider as OrcaConfig['provider']
  if (opts.apiKey) flags.apiKey = opts.apiKey
  if (opts.maxTurns) flags.maxTurns = parseInt(opts.maxTurns, 10)
  if (opts.systemPrompt) flags.systemPrompt = opts.systemPrompt
  if (opts.safe) flags.permissionMode = 'default'
  return flags
}
