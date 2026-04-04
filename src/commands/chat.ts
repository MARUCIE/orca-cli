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
import { existsSync, appendFileSync, mkdirSync as fsMkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  printRichBanner, printBanner, printProviderInfo, printProjectContext, printError,
  streamToken, ensureNewline, setLastNewline, printToolUse, printToolResult,
  printUsageSummary, printSessionSummary, emitJson,
  askPermission, printDiffPreview,
  printSeparator, printStatusLine,
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
          } else {
            // Interactive REPL: rich banner with ASCII art
            const configFiles = detectConfigFiles(cwd)
            printRichBanner({
              provider: resolved.provider,
              model: resolved.model,
              cwd,
              configFiles: configFiles.length > 0 ? configFiles : undefined,
              toolCount: TOOL_DEFINITIONS.length,
              mode: opts.safe ? 'safe' : 'yolo',
            })
          }
        }

        if (prompt) {
          await executeOneShot(prompt, resolved, config, outputMode, cwd)
        } else {
          await runREPL(resolved, config, outputMode, cwd, { safe: opts.safe, effort: opts.effort })
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
  opts: { safe?: boolean; effort?: string } = {},
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
    '/history', '/tokens', '/stats', '/retry', '/diff', '/git',
    '/save', '/load', '/sessions', '/undo', '/effort', '/council', '/race', '/pipeline',
    '/cwd', '/exit', '/quit',
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

  // Ctrl+L to clear screen + live slash hint
  let lastHintLen = 0
  rl.on('SIGCONT', () => { /* resume after bg */ })
  rl.on('line', () => { lastHintLen = 0 }) // clear hint state on submit
  process.stdin.on('keypress', (_ch: string, key: { name?: string; ctrl?: boolean }) => {
    if (key && key.ctrl && key.name === 'l') {
      process.stdout.write('\x1b[2J\x1b[H')
      rl.prompt()
      return
    }

    // Live slash command hint — show matching commands as user types
    const line = (rl as unknown as { line: string }).line
    if (line && line.startsWith('/') && line.length > 1 && line.length < 15) {
      const matches = SLASH_COMMANDS.filter(c => c.startsWith(line))
      // Clear previous hint
      if (lastHintLen > 0) {
        process.stdout.write(`\x1b[s\x1b[1B\x1b[2K\x1b[u`) // save, down, clear, restore
      }
      if (matches.length > 0 && matches.length <= 8) {
        const hint = matches.map(m => m === matches[0] ? `\x1b[36m${m}\x1b[0m` : `\x1b[90m${m}\x1b[0m`).join('  ')
        process.stdout.write(`\x1b[s\n\x1b[2K  ${hint}\x1b[u`) // save, newline, clear, write, restore
        lastHintLen = 1
      } else {
        lastHintLen = 0
      }
    } else if (lastHintLen > 0) {
      process.stdout.write(`\x1b[s\x1b[1B\x1b[2K\x1b[u`)
      lastHintLen = 0
    }
  })

  let stdinEnded = false
  rl.on('close', () => { stdinEnded = true })

  // Multi-turn conversation history
  const history: ChatMessage[] = []
  const sysPrompt = config.systemPrompt || buildSystemPrompt(cwd)
  history.push({ role: 'system', content: sysPrompt })

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
  let currentEffort: import('../output.js').ThinkingEffort =
    (opts.effort as import('../output.js').ThinkingEffort) || 'high'

  const shortModel = (m: string) => m.length > 24 ? m.slice(0, 22) + '..' : m

  // Get git branch (cached)
  let gitBranch: string | undefined
  try {
    const { execSync: execSyncImport } = await import('node:child_process')
    gitBranch = execSyncImport('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf-8' }).trim() || undefined
  } catch { /* not a git repo */ }

  const renderStatusAndPrompt = (): string => {
    const contextChars = history.reduce((sum, m) => sum + m.content.length, 0)
    const totalTokens = stats.totalInputTokens + stats.totalOutputTokens

    // Separator
    printSeparator()

    // Status line
    printStatusLine({
      model: currentModel,
      provider: resolved.provider,
      mode: opts.safe ? 'safe' : 'yolo',
      contextChars,
      totalTokens,
      cwd,
      gitBranch,
      effort: currentEffort,
    })

    // Return the actual prompt string
    const turnNum = stats.turns + 1
    return `\x1b[36m❯\x1b[0m `
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

  console.log('\x1b[90m  Type your message. /help for commands. Ctrl+C to quit.\x1b[0m')
  console.log('\x1b[90m  /council /race /pipeline — multi-model collaboration\x1b[0m\n')

  // Input history collector for persistence
  const inputHistory: string[] = []

  // Undo stack: track last write_file for /undo
  let lastWrite: { path: string; oldContent: string | null } | null = null

  while (true) {
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
        }, { lastWrite })
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

        // Multi-model commands (need async + baseURL)
        if ((handled as string) === 'council' || (handled as string) === 'race' || (handled as string) === 'pipeline') {
          const mmPrompt = input.replace(/^\/(council|race|pipeline)\s*/, '').trim()
          if (!mmPrompt) continue
          if (!resolved.baseURL) {
            console.log('\x1b[33m  multi-model requires proxy provider (poe). Use -p poe.\x1b[0m')
            continue
          }

          if ((handled as string) === 'council') {
            const models = pickDiverseModels(3)
            console.log(`\n\x1b[36m  ╭── Council: ${models.length} models ──╮\x1b[0m`)
            const result = await runCouncil({
              prompt: mmPrompt,
              models,
              judgeModel: models[0]!,
              apiKey: resolved.apiKey,
              baseURL: resolved.baseURL,
              onModelStart: (m) => process.stdout.write(`\x1b[90m  ● ${m}...\x1b[0m`),
              onModelDone: (m, ms) => console.log(` \x1b[32m${(ms/1000).toFixed(1)}s\x1b[0m`),
            })
            console.log()
            for (const r of result.responses) {
              if (r.error) {
                console.log(`\x1b[31m  ✗ ${r.model}: ${r.error}\x1b[0m`)
              } else {
                console.log(`\x1b[90m  ── ${r.model} (${(r.durationMs/1000).toFixed(1)}s) ──\x1b[0m`)
                console.log(`  ${r.text.slice(0, 500)}${r.text.length > 500 ? '...' : ''}\n`)
              }
            }
            console.log(`\x1b[36m  ★ Verdict\x1b[0m \x1b[90m(${result.verdict.model}, ${(result.verdict.durationMs/1000).toFixed(1)}s)\x1b[0m`)
            console.log(`  ${result.verdict.text}\n`)
            console.log(`\x1b[90m  ─ ${result.responses.length} models · ${(result.totalDurationMs/1000).toFixed(1)}s · agreement: ${result.agreement} ─\x1b[0m\n`)

          } else if ((handled as string) === 'race') {
            const models = pickDiverseModels(5)
            console.log(`\n\x1b[33m  ╭── Race: ${models.length} models ──╮\x1b[0m`)
            const result = await runRace({
              prompt: mmPrompt,
              models,
              apiKey: resolved.apiKey,
              baseURL: resolved.baseURL,
              onModelStart: (m) => process.stdout.write(`\x1b[90m  ◎ ${m}...\x1b[0m`),
              onModelDone: (m, ms, won) => console.log(won ? ` \x1b[32m★ WINNER ${(ms/1000).toFixed(1)}s\x1b[0m` : ` \x1b[90m${(ms/1000).toFixed(1)}s\x1b[0m`),
            })
            console.log()
            console.log(`\x1b[32m  Winner: ${result.winner.model} (${(result.winner.durationMs/1000).toFixed(1)}s)\x1b[0m`)
            console.log(`  ${result.winner.text}\n`)
            if (result.cancelled.length > 0) {
              console.log(`\x1b[90m  cancelled: ${result.cancelled.join(', ')}\x1b[0m`)
            }
            console.log(`\x1b[90m  ─ ${(result.totalDurationMs/1000).toFixed(1)}s total ─\x1b[0m\n`)

          } else if ((handled as string) === 'pipeline') {
            const stages: PipelineStage[] = [
              { role: 'plan', model: 'claude-opus-4.6' },
              { role: 'code', model: 'gpt-5.4' },
              { role: 'review', model: 'gemini-3.1-pro' },
            ]
            console.log(`\n\x1b[35m  ╭── Pipeline: ${stages.length} stages ──╮\x1b[0m`)
            const result = await runPipeline({
              prompt: mmPrompt,
              stages,
              apiKey: resolved.apiKey,
              baseURL: resolved.baseURL,
              onStageStart: (s, i) => process.stdout.write(`\x1b[90m  ${i+1}. ${s.role} (${s.model})...\x1b[0m`),
              onStageDone: (_s, _i, ms) => console.log(` \x1b[32m${(ms/1000).toFixed(1)}s\x1b[0m`),
            })
            console.log()
            for (const { stage, response } of result.stages) {
              console.log(`\x1b[90m  ── ${stage.role} · ${response.model} (${(response.durationMs/1000).toFixed(1)}s) ──\x1b[0m`)
              if (response.error) {
                console.log(`\x1b[31m  error: ${response.error}\x1b[0m\n`)
              } else {
                console.log(`  ${response.text.slice(0, 800)}${response.text.length > 800 ? '...' : ''}\n`)
              }
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
          onFileWrite: (path, oldContent) => { lastWrite = { path, oldContent } },
          safeMode: opts.safe || false,
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

    // ── Auto-compact: context management ──────────────────────
    // Thresholds (chars, ~4 chars/token, ~200K token window):
    //   40% = 320K chars → suggest
    //   60% = 480K chars → auto-compact (keep last 4 turns)
    //   80% = 640K chars → aggressive compact (keep last 2 turns)
    const ctxChars = history.reduce((sum, m) => sum + m.content.length, 0)
    const ctxPct = Math.round((ctxChars / 4 / 200_000) * 100)

    if (ctxPct >= 80) {
      // Aggressive: keep only system + last 2 messages
      hooks.run('PreCompact', { event: 'PreCompact', cwd })
      const sysMsg = history.find(m => m.role === 'system')
      const convMsgs = history.filter(m => m.role !== 'system')
      const keep = convMsgs.slice(-2)
      const dropped = convMsgs.length - keep.length
      history.length = 0
      if (sysMsg) history.push(sysMsg)
      history.push(...keep)
      hooks.run('PostCompact', { event: 'PostCompact', cwd })
      console.log(`\x1b[31m  auto-compact (${ctxPct}%): dropped ${dropped} messages, kept last 1 turn.\x1b[0m`)
    } else if (ctxPct >= 60) {
      // Standard: keep system + last 4 messages
      hooks.run('PreCompact', { event: 'PreCompact', cwd })
      const sysMsg = history.find(m => m.role === 'system')
      const convMsgs = history.filter(m => m.role !== 'system')
      const keep = convMsgs.slice(-4)
      const dropped = convMsgs.length - keep.length
      history.length = 0
      if (sysMsg) history.push(sysMsg)
      history.push(...keep)
      hooks.run('PostCompact', { event: 'PostCompact', cwd })
      console.log(`\x1b[33m  auto-compact (${ctxPct}%): dropped ${dropped} messages, kept last 2 turns.\x1b[0m`)
    } else if (ctxPct >= 40) {
      console.log(`\x1b[33m  context: ${ctxPct}% — consider /compact to free space.\x1b[0m`)
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
    const sessDir = join(process.env.HOME || '/tmp', '.armature', 'sessions')
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
}

interface UndoState {
  lastWrite: { path: string; oldContent: string | null } | null
}

const POE_MODELS = [
  'claude-opus-4.6',
  'claude-sonnet-4.6',
  'gpt-5.4',
  'gemini-3.1-pro',
  'gemini-3.1-flash-lite',
  'gemma-4-31b',
  'glm-5',
  'grok-4.20-multi-agent',
  'qwen3.6-plus',
  'kimi-k2.5',
  'minimax-m2.7',
]

function handleSlashCommand(
  input: string,
  resolved: ResolvedProvider,
  history: ChatMessage[],
  stats: SessionStats,
  cwd: string,
  mc: ModelControl,
  undo?: UndoState,
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
      console.log('  /diff                  Show git diff')
      console.log('  /git <cmd>             Run git command')
      console.log('  /save [name]           Save session to disk')
      console.log('  /load [name]           Load a saved session')
      console.log('  /sessions              List saved sessions')
      console.log('  /undo                  Revert last file write')
      console.log('  /effort <level>        Set thinking: low/medium/high/max')
      console.log('  /hooks                 Show registered hooks')
      console.log('  /council <prompt>      Ask N models, judge synthesizes (multi-model)')
      console.log('  /race <prompt>         First model to answer wins (speed race)')
      console.log('  /pipeline <prompt>     Plan→Code→Review chain across models')
      console.log('  /cwd                   Working directory')
      console.log('  /exit, /quit, /q       Exit')
      console.log('')
      console.log('  Tips:')
      console.log('  Start with ``` for multi-line input (close with ```)')
      console.log('  Esc interrupts generation. Ctrl+L clears screen.')
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
        hooks.run('PreCompact', { event: 'PreCompact', cwd })
        const sysMsg = history.find(m => m.role === 'system')
        const convMsgs = history.filter(m => m.role !== 'system')
        const keep = convMsgs.slice(-4) // last 2 turns (user + assistant each)
        const dropped = convMsgs.length - keep.length
        history.length = 0
        if (sysMsg) history.push(sysMsg)
        history.push(...keep)
        console.log(`\x1b[90m  compacted: kept last 2 turns, dropped ${dropped} messages.\x1b[0m`)
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
        const { execSync } = require('node:child_process') as typeof import('node:child_process')
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
        const { execSync } = require('node:child_process') as typeof import('node:child_process')
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
      const sessDir = join(process.env.HOME || '/tmp', '.armature', 'sessions')
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
      const sessDir = join(process.env.HOME || '/tmp', '.armature', 'sessions')
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
      const sessDir = join(process.env.HOME || '/tmp', '.armature', 'sessions')
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
  onFileWrite?: (path: string, oldContent: string | null) => void
  safeMode?: boolean
}

async function runProxyTurn(options: ProxyTurnOptions): Promise<{ inputTokens: number; outputTokens: number }> {
  const { prompt, resolved, config, outputMode, history, cwd, abortSignal, onFirstToken, onFileWrite, safeMode } = options

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

        // Sub-agent tools — spawn a new streamChat conversation
        if (name === 'spawn_agent' || name === 'delegate_task') {
          const subTask = String(args.task || args.context || '')
          if (!subTask) return { success: false, output: 'task is required.' }

          await hooks.run('SubagentStart', { event: 'SubagentStart', cwd, model: resolved.model })
          console.log(`\x1b[90m  spawning sub-agent...\x1b[0m`)

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

        // PostToolUse hook — for logging/modification
        if (hooks.hasHooks('PostToolUse')) {
          await hooks.run('PostToolUse', {
            event: 'PostToolUse', toolName: name, toolInput: args,
            toolOutput: result.output, toolSuccess: result.success, cwd,
          })
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
  if (opts.safe) flags.permissionMode = 'default'
  return flags
}
