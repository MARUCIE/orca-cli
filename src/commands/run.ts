/**
 * `forge run` — Execute an agent task in the current directory.
 *
 * Unlike `chat`, `run` is designed for task execution:
 *   - Defaults to acceptEdits permission mode
 *   - Includes file/shell/search tools by default
 *   - Outputs structured result summary
 *
 * Usage:
 *   forge run "fix the failing tests"
 *   forge run "add error handling to api.ts" --model claude-opus-4-20250514
 *   forge run "refactor to TypeScript" --max-turns 50
 */

import { Command } from 'commander'
import type { ForgeConfig } from '../config.js'
import { resolveConfig, resolveProvider } from '../config.js'
import {
  printBanner, printProviderInfo, printError,
  ensureNewline, setLastNewline, printToolUse, printToolResult,
  printUsageSummary, emitJson,
} from '../output.js'
import type { OutputMode } from '../output.js'
import { StreamMarkdown } from '../markdown.js'
import { buildSystemPrompt } from '../system-prompt.js'

interface RunOptions {
  model?: string
  provider?: string
  apiKey?: string
  maxTurns?: string
  systemPrompt?: string
  json?: boolean
  cwd?: string
  dangerously?: boolean
}

export function createRunCommand(): Command {
  return new Command('run')
    .description('Execute an agent task in the current directory')
    .argument('<task...>', 'Task description')
    .option('-m, --model <model>', 'Model name')
    .option('-p, --provider <provider>', 'Provider (anthropic, openai, google, auto)')
    .option('-k, --api-key <key>', 'API key')
    .option('--max-turns <n>', 'Maximum agent turns', '50')
    .option('-s, --system-prompt <prompt>', 'System prompt')
    .option('--json', 'Output as NDJSON')
    .option('--cwd <dir>', 'Working directory')
    .option('--dangerously', 'Skip permission prompts (use with caution)')
    .action(async (taskParts: string[], opts: RunOptions) => {
      const task = taskParts.join(' ').trim()
      const outputMode: OutputMode = opts.json ? 'json' : 'streaming'

      try {
        const config = resolveConfig({
          cwd: opts.cwd || process.cwd(),
          flags: buildFlags(opts),
        })

        const resolved = resolveProvider(config)

        if (outputMode === 'streaming') {
          printBanner()
          printProviderInfo(resolved.provider, resolved.model)
        }

        await executeTask({
          task,
          provider: resolved.provider,
          apiKey: resolved.apiKey,
          model: resolved.model,
          baseURL: resolved.baseURL,
          config,
          outputMode,
          cwd: opts.cwd || process.cwd(),
          dangerously: opts.dangerously || false,
        })
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

interface ExecuteTaskOptions {
  task: string
  provider: string
  apiKey: string
  model: string
  baseURL?: string
  config: ForgeConfig
  outputMode: OutputMode
  cwd: string
  dangerously: boolean
}

async function executeTask(options: ExecuteTaskOptions): Promise<void> {
  const { task, provider, apiKey, model, baseURL, config, outputMode, cwd, dangerously } = options

  let sdk: { createAgent: (opts: Record<string, unknown>) => { query: (p: string) => AsyncIterable<unknown> } }
  try {
    // @ts-ignore — @armature/sdk is an optional dependency for native provider path
    sdk = await import('@armature/sdk')
  } catch {
    throw new Error('@armature/sdk not installed. Use --provider poe for proxy mode, or npm install @armature/sdk for native mode.')
  }

  if (dangerously) {
    console.error('\x1b[33mwarn: --dangerously active — agent has unrestricted shell/filesystem access\x1b[0m')
  }

  const permissionMode = dangerously
    ? 'bypassPermissions'
    : (config.permissionMode === 'default' ? 'acceptEdits' : config.permissionMode)

  // Map CLI provider to SDK provider option
  const sdkProvider = provider === 'anthropic' ? 'anthropic' : 'openai-compat'

  const agent = sdk.createAgent({
    provider: sdkProvider,
    apiKey,
    model,
    baseURL,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    systemPrompt: config.systemPrompt || buildSystemPrompt(cwd),
    permissionMode: permissionMode as 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan',
    cwd,
  })

  const startTime = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let toolCalls = 0
  const md = new StreamMarkdown()

  for await (const event of agent.query(task)) {
    if (outputMode === 'json') {
      emitJson(event as unknown as Record<string, unknown>)
      continue
    }

    const ev = event as Record<string, unknown>
    const type = ev.type as string | undefined

    if (type === 'text' || type === 'content_block_delta') {
      const text = (ev.text as string) || (ev.delta as Record<string, unknown>)?.text as string || ''
      if (text) md.push(text)
    } else if (type === 'tool_use' || type === 'tool_call') {
      md.flush(); setLastNewline(md.endsWithNewline)
      toolCalls++
      const toolName = (ev.name as string) || (ev.tool as string) || 'tool'
      let input: string | undefined
      try { input = ev.input ? JSON.stringify(ev.input) : undefined } catch { input = '[complex input]' }
      printToolUse(toolName, input)
    } else if (type === 'tool_result') {
      const toolName = (ev.name as string) || 'tool'
      const success = (ev.is_error as boolean) !== true
      printToolResult(toolName, success)
    } else if (type === 'result') {
      const result = ev as Record<string, unknown>
      inputTokens = (result.inputTokens as number) || 0
      outputTokens = (result.outputTokens as number) || 0
      turns = (result.turns as number) || 0
    }
  }

  md.flush()

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

function buildFlags(opts: RunOptions): Partial<ForgeConfig> {
  const flags: Partial<ForgeConfig> = {}
  if (opts.model) flags.model = opts.model
  if (opts.provider) flags.provider = opts.provider as ForgeConfig['provider']
  if (opts.apiKey) flags.apiKey = opts.apiKey
  if (opts.maxTurns) flags.maxTurns = parseInt(opts.maxTurns, 10)
  if (opts.systemPrompt) flags.systemPrompt = opts.systemPrompt
  return flags
}

