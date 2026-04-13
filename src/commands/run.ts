/**
 * `orca run` — Execute an agent task in the current directory.
 *
 * Unlike `chat`, `run` is designed for task execution:
 *   - Defaults to acceptEdits permission mode
 *   - Includes file/shell/search tools by default
 *   - Outputs structured result summary
 *
 * Usage:
 *   orca run "fix the failing tests"
 *   orca run "add error handling to api.ts" --model claude-opus-4-20250514
 *   orca run "refactor to TypeScript" --max-turns 50
 */

import { Command } from 'commander'
import { getPricingForModel } from '../model-catalog.js'
import type { OrcaConfig } from '../config.js'
import { resolveConfig, resolveProvider } from '../config.js'
import { parseDoneCriteria, runGoalLoop } from '../harness/goal-loop.js'
import { chatOnce } from '../providers/openai-compat.js'
import { MissionController } from '../mission/index.js'
import type { MissionEvent } from '../mission/index.js'
import { decomposePrompt, executePlan } from '../planner/index.js'
import type { PlanEvent } from '../planner/index.js'
import {
  printBanner, printProviderInfo, printError,
  ensureNewline, setLastNewline, printToolUse, printToolResult,
  printUsageSummary, emitJson,
} from '../output.js'
import type { OutputMode } from '../output.js'
import { StreamMarkdown } from '../markdown.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { recordUsage } from '../usage-db.js'

interface RunOptions {
  model?: string
  provider?: string
  apiKey?: string
  maxTurns?: string
  systemPrompt?: string
  json?: boolean
  cwd?: string
  dangerously?: boolean
  doneWhen?: string
  mission?: boolean
  plan?: boolean
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
    .option('--done-when <criteria>', 'Goal-loop: repeat until criteria met (e.g., "tests pass", "/pattern/", "exit 0: cmd")')
    .option('--mission', 'Mission mode: autonomous plan→implement→validate cycle')
    .option('--plan', 'Plan mode: decompose into tasks, execute main+side concurrently')
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

        const runCwd = opts.cwd || process.cwd()

        // Goal-loop mode: repeat task until criteria met
        if (opts.doneWhen) {
          const criteria = parseDoneCriteria(opts.doneWhen)
          console.log(`\x1b[36m  goal-loop: ${criteria.type} — "${criteria.value}"\x1b[0m`)
          console.log(`\x1b[90m  max iterations: ${config.maxTurns}\x1b[0m\n`)

          const result = await runGoalLoop(
            {
              maxIterations: Math.min(config.maxTurns || 10, 20),
              doneCriteria: criteria,
              cwd: runCwd,
              onIterationStart: (i, max) => {
                console.log(`\x1b[36m  ── iteration ${i}/${max} ──\x1b[0m`)
              },
              onIterationDone: (i, passed, output) => {
                const icon = passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[33mFAIL\x1b[0m'
                console.log(`\x1b[90m  check: ${icon} ${output.slice(0, 100)}\x1b[0m\n`)
              },
            },
            async (iteration, feedback) => {
              const iterPrompt = feedback
                ? `${task}\n\nIteration ${iteration}. Previous attempt did not meet the done criteria.\nFeedback: ${feedback}\nTry a different approach.`
                : task

              // Call the LLM for each iteration
              if (resolved.baseURL) {
                try {
                  const sysPrompt = config.systemPrompt || buildSystemPrompt(runCwd)
                  const result = await chatOnce(
                    { apiKey: resolved.apiKey, baseURL: resolved.baseURL, model: resolved.model, systemPrompt: sysPrompt },
                    iterPrompt,
                  )
                  if (outputMode === 'streaming') {
                    process.stdout.write(`\x1b[90m${result.text.slice(0, 500)}\x1b[0m\n`)
                  }
                  return result.text
                } catch (err) {
                  return `Error: ${err instanceof Error ? err.message : String(err)}`
                }
              }
              return `(no provider baseURL configured — cannot execute)`
            },
          )

          if (result.success) {
            console.log(`\x1b[32m  goal-loop: PASSED in ${result.iterations} iteration(s) (${(result.totalDurationMs / 1000).toFixed(1)}s)\x1b[0m`)
          } else {
            console.log(`\x1b[31m  goal-loop: ${result.reason} after ${result.iterations} iteration(s)\x1b[0m`)
            console.log(`\x1b[90m  ${result.lastOutput}\x1b[0m`)
          }
          return
        }

        // Mission mode: plan → implement → validate cycle
        if (opts.mission) {
          if (!resolved.baseURL) {
            throw new Error('Mission mode requires a provider with baseURL configured.')
          }
          const controller = new MissionController(task, runCwd, {
            apiKey: resolved.apiKey,
            baseURL: resolved.baseURL,
            model: resolved.model,
          })

          controller.onEvent((event: MissionEvent) => {
            const icons: Record<string, string> = {
              plan_created: '\x1b[36m[plan]\x1b[0m',
              milestone_started: '\x1b[35m[milestone]\x1b[0m',
              milestone_passed: '\x1b[32m[PASS]\x1b[0m',
              milestone_failed: '\x1b[31m[FAIL]\x1b[0m',
              feature_started: '\x1b[90m[feature]\x1b[0m',
              feature_completed: '\x1b[32m[done]\x1b[0m',
              feature_failed: '\x1b[33m[fail]\x1b[0m',
              validation_started: '\x1b[36m[validate]\x1b[0m',
              validation_passed: '\x1b[32m[PASS]\x1b[0m',
              validation_failed: '\x1b[31m[FAIL]\x1b[0m',
              mission_completed: '\x1b[32m[MISSION]\x1b[0m',
              mission_failed: '\x1b[31m[MISSION]\x1b[0m',
              mission_aborted: '\x1b[33m[ABORT]\x1b[0m',
            }
            const icon = icons[event.type] || '\x1b[90m[?]\x1b[0m'
            if (outputMode === 'json') {
              emitJson({ type: 'mission_event', event: event.type, message: event.message })
            } else {
              console.log(`  ${icon} ${event.message}`)
            }
          })

          console.log(`\x1b[36m  mission: planning...\x1b[0m`)
          const plan = await controller.plan()
          console.log(`\x1b[90m  ${plan.milestones.length} milestones, ${plan.features.length} features, ~${plan.estimatedRuns} runs\x1b[0m`)
          console.log(`\x1b[36m  mission: executing...\x1b[0m\n`)

          const state = await controller.execute()

          console.log()
          if (state.phase === 'completed') {
            console.log(`\x1b[32m  mission completed: ${state.featuresValidated} features validated, ${state.totalRuns} runs\x1b[0m`)
          } else {
            console.log(`\x1b[31m  mission ${state.phase}: ${state.error || 'unknown error'}\x1b[0m`)
          }

          const elapsed = state.completedAt
            ? new Date(state.completedAt).getTime() - new Date(state.startedAt).getTime()
            : Date.now() - new Date(state.startedAt).getTime()
          console.log(`\x1b[90m  tokens: ${state.totalTokens.toLocaleString()} · ${(elapsed / 1000).toFixed(1)}s\x1b[0m`)
          return
        }

        // Plan mode: decompose into tasks + concurrent execution
        if (opts.plan) {
          if (!resolved.baseURL) {
            throw new Error('Plan mode requires a provider with baseURL configured.')
          }

          console.log(`\x1b[36m  plan: decomposing tasks...\x1b[0m`)
          const plan = await decomposePrompt(task, {
            apiKey: resolved.apiKey,
            baseURL: resolved.baseURL,
            model: resolved.model,
          })

          const mainCount = plan.tasks.filter(t => t.type === 'main').length
          const sideCount = plan.tasks.filter(t => t.type === 'side').length
          console.log(`\x1b[90m  ${plan.tasks.length} tasks: ${mainCount} main + ${sideCount} side\x1b[0m\n`)

          const { result } = await executePlan(plan, {
            apiKey: resolved.apiKey,
            baseURL: resolved.baseURL,
            model: resolved.model,
            cwd: runCwd,
          })

          console.log()
          if (result.success) {
            console.log(`\x1b[32m  plan completed: ${result.completed}/${result.totalTasks} tasks\x1b[0m`)
          } else {
            console.log(`\x1b[31m  plan finished: ${result.completed} done, ${result.failed} failed, ${result.skipped} skipped\x1b[0m`)
          }
          console.log(`\x1b[90m  tokens: ${result.totalTokens.toLocaleString()} · ${(result.totalDurationMs / 1000).toFixed(1)}s\x1b[0m`)
          return
        }

        await executeTask({
          task,
          provider: resolved.provider,
          apiKey: resolved.apiKey,
          model: resolved.model,
          baseURL: resolved.baseURL,
          config,
          outputMode,
          cwd: runCwd,
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
  config: OrcaConfig
  outputMode: OutputMode
  cwd: string
  dangerously: boolean
}

async function executeTask(options: ExecuteTaskOptions): Promise<void> {
  const { task, provider, apiKey, model, baseURL, config, outputMode, cwd, dangerously } = options

  let sdk: { createAgent: (opts: Record<string, unknown>) => { query: (p: string) => AsyncIterable<unknown> } }
  try {
    // @ts-ignore — @orca/sdk is an optional dependency for native provider path
    sdk = await import('@orca/sdk')
  } catch {
    throw new Error('@orca/sdk not installed. Use --provider poe for proxy mode, or npm install @orca/sdk for native mode.')
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

  recordUsage({
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd: (() => { const p = getPricingForModel(model); return p ? (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000 : 0 })(),
    durationMs: Date.now() - startTime,
    turns,
    command: 'run',
    cwd,
  })
}

function buildFlags(opts: RunOptions): Partial<OrcaConfig> {
  const flags: Partial<OrcaConfig> = {}
  if (opts.model) flags.model = opts.model
  if (opts.provider) flags.provider = opts.provider as OrcaConfig['provider']
  if (opts.apiKey) flags.apiKey = opts.apiKey
  if (opts.maxTurns) flags.maxTurns = parseInt(opts.maxTurns, 10)
  if (opts.systemPrompt) flags.systemPrompt = opts.systemPrompt
  return flags
}

