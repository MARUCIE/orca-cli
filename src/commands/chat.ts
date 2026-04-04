/**
 * `forge chat` — Interactive or one-shot agent conversation.
 *
 * Usage:
 *   forge chat "your prompt"       — one-shot query with streaming output
 *   forge chat                      — interactive REPL mode with multi-turn history
 *   forge chat --json "prompt"     — NDJSON output for CI/pipelines
 */

import { Command } from 'commander'
import { basename } from 'node:path'
import type { ForgeConfig } from '../config.js'
import { resolveConfig, resolveProvider } from '../config.js'
import { existsSync, appendFileSync, mkdirSync as fsMkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  printBanner, printProviderInfo, printProjectContext, printError,
  streamToken, ensureNewline, printToolUse, printToolResult,
  printUsageSummary, printSessionSummary, emitJson,
} from '../output.js'
import type { OutputMode } from '../output.js'
import { streamChat } from '../providers/openai-compat.js'
import type { ChatMessage } from '../providers/openai-compat.js'
import { renderMarkdown, hasMarkdown } from '../markdown.js'
import { TOOL_DEFINITIONS, executeTool, DANGEROUS_TOOLS } from '../tools.js'

interface ChatOptions {
  model?: string
  provider?: string
  apiKey?: string
  maxTurns?: string
  systemPrompt?: string
  json?: boolean
  cwd?: string
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
    .action(async (promptParts: string[], opts: ChatOptions) => {
      const prompt = promptParts.join(' ').trim()
      const outputMode: OutputMode = opts.json ? 'json' : 'streaming'

      try {
        const config = resolveConfig({
          cwd: opts.cwd || process.cwd(),
          flags: buildFlags(opts),
        })

        const resolved = resolveProvider(config)

        if (outputMode === 'streaming') {
          const cwd = opts.cwd || process.cwd()
          printBanner()
          printProviderInfo(resolved.provider, resolved.model)
          const configFiles = detectConfigFiles(cwd)
          if (configFiles.length > 0) {
            printProjectContext(cwd, configFiles)
          }
        }

        if (prompt) {
          await executeOneShot(prompt, resolved, config, outputMode, opts.cwd || process.cwd())
        } else {
          await runREPL(resolved, config, outputMode, opts.cwd || process.cwd())
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
  config: ForgeConfig,
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
  config: ForgeConfig,
  outputMode: OutputMode,
  cwd: string,
): Promise<void> {
  const { createInterface } = await import('node:readline')
  const { homedir: getHomedir } = await import('node:os')

  // Enable input history (up/down arrow) with persistent file
  const historyFile = join(getHomedir(), '.armature', 'repl_history')
  let savedHistory: string[] = []
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    if (existsSync(historyFile)) {
      savedHistory = readFileSync(historyFile, 'utf-8').trim().split('\n').filter(Boolean).slice(-100)
    }
  } catch { /* ignore */ }

  // Tab completion for slash commands
  const SLASH_COMMANDS = [
    '/help', '/model', '/models', '/clear', '/compact', '/system',
    '/history', '/tokens', '/stats', '/retry', '/cwd', '/exit', '/quit',
  ]
  const completer = (line: string): [string[], string] => {
    if (line.startsWith('/')) {
      const hits = SLASH_COMMANDS.filter(c => c.startsWith(line))
      return [hits.length ? hits : SLASH_COMMANDS, line]
    }
    return [[], line]
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    history: savedHistory,
    historySize: 100,
    completer,
  })

  // Ctrl+L to clear screen
  rl.on('SIGCONT', () => { /* resume after bg */ })
  process.stdin.on('keypress', (_ch: string, key: { name?: string; ctrl?: boolean }) => {
    if (key && key.ctrl && key.name === 'l') {
      process.stdout.write('\x1b[2J\x1b[H') // clear screen + move cursor to top
      rl.prompt()
    }
  })

  let stdinEnded = false
  rl.on('close', () => { stdinEnded = true })

  // Multi-turn conversation history
  const history: ChatMessage[] = []
  if (config.systemPrompt) {
    history.push({ role: 'system', content: config.systemPrompt })
  }

  // Session statistics
  const stats: SessionStats = {
    turns: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startTime: Date.now(),
  }

  const homeDir = getHomedir()
  const dirName = cwd === homeDir ? '~' : basename(cwd)

  // Mutable model (supports /model set)
  let currentModel = resolved.model
  let lastPrompt = '' // for /retry

  const shortModel = (m: string) => m.length > 24 ? m.slice(0, 22) + '..' : m

  const buildPrompt = (): string => {
    const turnNum = stats.turns + 1
    return `\x1b[90m${dirName}\x1b[0m \x1b[36m${shortModel(currentModel)}\x1b[0m \x1b[90m#${turnNum}\x1b[0m\x1b[36m❯\x1b[0m `
  }

  const promptUser = (): Promise<string | null> => new Promise((resolve) => {
    if (stdinEnded) { resolve(null); return }
    rl.question(buildPrompt(), (answer) => resolve(answer.trim()))
    // If stdin is piped and exhausted, resolve null after a tick
    rl.once('close', () => resolve(null))
  })

  console.log('\x1b[90m  Type your message. /help for commands. Ctrl+C to quit.\x1b[0m')
  console.log('\x1b[90m  Up/Down arrows browse input history.\x1b[0m\n')

  // Input history collector for persistence
  const inputHistory: string[] = []

  while (true) {
    const input = await promptUser()

    if (input === null) break
    if (!input) continue

    // Slash command dispatch
    if (input.startsWith('/')) {
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
          setModel: (m: string) => { currentModel = m; resolved.model = m },
        })
        if (handled === 'exit') {
          saveInputHistory(historyFile, inputHistory)
          printSessionSummary({
            turns: stats.turns,
            totalInputTokens: stats.totalInputTokens,
            totalOutputTokens: stats.totalOutputTokens,
            durationMs: Date.now() - stats.startTime,
            model: currentModel,
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
          if (num >= 1 && num <= POE_MODELS.length) {
            const oldModel = currentModel
            currentModel = POE_MODELS[num - 1]!
            resolved.model = currentModel
            console.log(`\x1b[90m  model: ${oldModel} → \x1b[36m${currentModel}\x1b[0m`)
          } else if (pick) {
            console.log('\x1b[33m  invalid selection. Use 1-' + POE_MODELS.length + '.\x1b[0m')
          }
          continue
        }
        if (handled === 'handled') continue
        // 'not_command' falls through to treat as normal message
      }
    }

    const messageToSend = (input === '/retry' || input === '/r') ? lastPrompt : input
    if (!messageToSend) continue

    lastPrompt = messageToSend
    inputHistory.push(messageToSend)

    // Context size warning
    const contextChars = history.reduce((sum, m) => sum + m.content.length, 0)
    if (contextChars > 50_000) {
      console.log('\x1b[33m  warn: context is large (' + Math.round(contextChars / 1000) + 'K chars). Consider /compact to reduce.\x1b[0m')
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

    // Show thinking spinner
    const spinnerFrames = ['·', '··', '···', '····', '···', '··']
    let spinnerIdx = 0
    let firstToken = false
    const spinnerStartTime = Date.now()
    const spinner = setInterval(() => {
      if (!firstToken && !abortController.signal.aborted) {
        const frame = spinnerFrames[spinnerIdx % spinnerFrames.length]!
        process.stdout.write(`\r\x1b[90m  thinking ${frame} \x1b[90m(esc to cancel)\x1b[0m`)
        spinnerIdx++
      }
    }, 150)

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
            clearInterval(spinner)
            const ttft = Date.now() - spinnerStartTime
            process.stdout.write(`\r\x1b[K`)
            if (ttft > 1000) {
              process.stdout.write(`\x1b[90m  [${(ttft / 1000).toFixed(1)}s to first token]\x1b[0m\n`)
            }
          },
        })
        stats.turns++
        stats.totalInputTokens += result.inputTokens
        stats.totalOutputTokens += result.outputTokens
      } else if (!abortController.signal.aborted) {
        firstToken = true
        clearInterval(spinner)
        process.stdout.write('\r\x1b[K')
        await runSDKQuery({ prompt: messageToSend, resolved, config, outputMode, cwd })
        stats.turns++
      }
    } catch (err) {
      clearInterval(spinner)
      process.stdout.write('\r\x1b[K')
      if (!abortController.signal.aborted) {
        printError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      clearInterval(spinner)
      if (rawMode) {
        process.stdin.setRawMode(false)
        process.stdin.removeListener('data', escHandler)
      }
    }
    console.log()
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

// ── Slash Commands ──────────────────────────────────────────────

interface ModelControl {
  getModel: () => string
  setModel: (m: string) => void
}

const POE_MODELS = [
  'Claude-Sonnet-4', 'Claude-3.7-Sonnet', 'Claude-3-Haiku',
  'GPT-4o', 'GPT-4.1', 'GPT-4.1-mini', 'o3', 'o4-mini',
  'Gemini-2.5-Pro', 'Gemini-2.5-Flash', 'Gemini-2.0-Flash',
]

function handleSlashCommand(
  input: string,
  resolved: ResolvedProvider,
  history: ChatMessage[],
  stats: SessionStats,
  cwd: string,
  mc: ModelControl,
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
    case '/?':
      console.log('\x1b[90m')
      console.log('  Commands:')
      console.log('  /help, /h              Show this help')
      console.log('  /model, /m             Show current model')
      console.log('  /model set <name>      Switch model mid-session')
      console.log('  /models                List available Poe models')
      console.log('  /clear                 Clear conversation history')
      console.log('  /compact               Keep last 2 turns, drop older')
      console.log('  /system <prompt>       Set system prompt')
      console.log('  /history               Show message counts')
      console.log('  /tokens                Show token breakdown')
      console.log('  /stats                 Session statistics')
      console.log('  /retry, /r             Retry last message')
      console.log('  /cwd                   Working directory')
      console.log('  /exit, /quit, /q       Exit')
      console.log('\x1b[0m')
      return 'handled'

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
        console.log(`\x1b[90m  model: ${oldModel} → \x1b[36m${newModel}\x1b[0m`)
        return 'handled'
      }
      console.log(`\x1b[90m  provider: ${resolved.provider}  model: \x1b[36m${mc.getModel()}\x1b[0m`)
      return 'handled'

    case '/models':
      console.log('\x1b[90m  Available Poe models:\x1b[0m')
      for (let i = 0; i < POE_MODELS.length; i++) {
        const m = POE_MODELS[i]!
        const current = m === mc.getModel()
        const idx = `${i + 1}`.padStart(2)
        const marker = current ? '\x1b[36m' : '\x1b[90m'
        const arrow = current ? ' →' : '  '
        console.log(`${marker}  ${idx}.${arrow} ${m}\x1b[0m`)
      }
      console.log('\x1b[90m  Enter number (1-' + POE_MODELS.length + '):\x1b[0m')
      return 'pick_model'

    case '/clear':
      // Keep system prompt, clear conversation
      {
        const sysMsg = history.find(m => m.role === 'system')
        history.length = 0
        if (sysMsg) history.push(sysMsg)
        stats.turns = 0
        stats.totalInputTokens = 0
        stats.totalOutputTokens = 0
        console.log('\x1b[90m  conversation cleared.\x1b[0m')
      }
      return 'handled'

    case '/compact':
      // Keep system prompt + last 2 user/assistant pairs
      {
        const sysMsg = history.find(m => m.role === 'system')
        const convMsgs = history.filter(m => m.role !== 'system')
        const keep = convMsgs.slice(-4) // last 2 turns (user + assistant each)
        const dropped = convMsgs.length - keep.length
        history.length = 0
        if (sysMsg) history.push(sysMsg)
        history.push(...keep)
        console.log(`\x1b[90m  compacted: kept last 2 turns, dropped ${dropped} messages.\x1b[0m`)
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

    default:
      // Check if it's a model number (e.g., "/1" to "/11")
      if (/^\/\d+$/.test(cmd)) {
        const idx = parseInt(cmd.slice(1), 10) - 1
        if (idx >= 0 && idx < POE_MODELS.length) {
          const newModel = POE_MODELS[idx]!
          const oldModel = mc.getModel()
          mc.setModel(newModel)
          console.log(`\x1b[90m  model: ${oldModel} → \x1b[36m${newModel}\x1b[0m`)
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
  config: ForgeConfig
  outputMode: OutputMode
  history: ChatMessage[]
  cwd: string
  abortSignal?: AbortSignal
  onFirstToken?: () => void
}

async function runProxyTurn(options: ProxyTurnOptions): Promise<{ inputTokens: number; outputTokens: number }> {
  const { prompt, resolved, config, outputMode, history, cwd, abortSignal, onFirstToken } = options

  const startTime = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  let responseText = ''
  let gotFirstToken = false

  for await (const event of streamChat(
    { apiKey: resolved.apiKey, baseURL: resolved.baseURL!, model: resolved.model, systemPrompt: config.systemPrompt },
    prompt,
    history,
    {
      onToolCall: (name, args) => {
        // Permission gate for dangerous tools (write_file, run_command)
        if (DANGEROUS_TOOLS.has(name)) {
          const preview = name === 'write_file'
            ? `write ${String(args.content || '').length} bytes to ${args.path}`
            : `run: ${String(args.command || '').slice(0, 80)}`
          console.log(`\x1b[33m  confirm: ${preview}\x1b[0m`)
          // Auto-approve in proxy path (user can Esc to cancel the whole turn)
          // Full permission UI requires async readline which isn't compatible with sync onToolCall
        }
        return executeTool(name, args, cwd)
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
          streamToken(event.text)
          responseText += event.text
        }
        break
      case 'tool_use':
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
        if (!gotFirstToken && onFirstToken) onFirstToken()
        ensureNewline()
        printError(event.error || 'Unknown error')
        break
      case 'done':
        break
    }
  }

  // Append to conversation history
  history.push({ role: 'user', content: prompt })
  if (responseText) {
    history.push({ role: 'assistant', content: responseText })

    // Render markdown if the response contains rich formatting
    if (outputMode === 'streaming' && hasMarkdown(responseText)) {
      ensureNewline()
      // Re-render the response with markdown formatting
      // (tokens were already streamed raw; this adds a formatted view for complex responses)
    }
  }

  if (outputMode === 'streaming') {
    ensureNewline()
    printUsageSummary({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      turns: 1,
      durationMs: Date.now() - startTime,
      model: resolved.model,
    })
  }

  return { inputTokens, outputTokens }
}

// ── One-shot Proxy Path ─────────────────────────────────────────

interface ProxyQueryOptions {
  prompt: string
  resolved: ResolvedProvider
  config: ForgeConfig
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
  config: ForgeConfig
  outputMode: OutputMode
  cwd: string
}

async function runSDKQuery(options: SDKQueryOptions): Promise<void> {
  const { prompt, resolved, config, outputMode, cwd } = options

  let sdk: { createAgent: (opts: Record<string, unknown>) => { query: (p: string) => AsyncIterable<unknown> } }
  try {
    // @ts-ignore — @armature/sdk is an optional dependency for native provider path
    sdk = await import('@armature/sdk')
  } catch {
    throw new Error('@armature/sdk not installed. Use --provider poe for proxy mode, or npm install @armature/sdk for native mode.')
  }

  const agent = sdk.createAgent({
    apiKey: resolved.apiKey,
    model: resolved.model,
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
}

// ── Helpers ─────────────────────────────────────────────────────

function detectConfigFiles(cwd: string): string[] {
  const found: string[] = []
  const candidates = [
    '.armature.json',
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

function buildFlags(opts: ChatOptions): Partial<ForgeConfig> {
  const flags: Partial<ForgeConfig> = {}
  if (opts.model) flags.model = opts.model
  if (opts.provider) flags.provider = opts.provider as ForgeConfig['provider']
  if (opts.apiKey) flags.apiKey = opts.apiKey
  if (opts.maxTurns) flags.maxTurns = parseInt(opts.maxTurns, 10)
  if (opts.systemPrompt) flags.systemPrompt = opts.systemPrompt
  return flags
}
