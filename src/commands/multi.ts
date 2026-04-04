/**
 * `forge council` / `forge race` / `forge pipeline`
 *
 * Multi-model collaboration commands — the feature no single-vendor CLI can have.
 *
 * Usage:
 *   forge council "should we use SQL or NoSQL?"           # 3 models + judge
 *   forge council "review this code" -n 5                 # 5 models + judge
 *   forge race "write a CSV parser"                       # first model wins
 *   forge race "explain monads" -n 3                      # 3 models race
 *   forge pipeline "build a REST API"                     # plan→code→review
 *   forge pipeline "refactor to TypeScript" --stages 5    # 5-stage pipeline
 */

import { Command } from 'commander'
import { resolveConfig, resolveProvider } from '../config.js'
import { printBanner, printError } from '../output.js'
import { runCouncil, runRace, runPipeline, pickDiverseModels } from '../multi-model.js'
import { StreamMarkdown } from '../markdown.js'
import type { ForgeConfig } from '../config.js'
import type { PipelineStage } from '../multi-model.js'

// ── Council Command ──────────────────────────────────────────────

export function createCouncilCommand(): Command {
  return new Command('council')
    .description('Ask multiple models the same question, synthesize the best answer')
    .argument('<prompt...>', 'Question or task')
    .option('-n, --models <n>', 'Number of models to consult', '3')
    .option('-j, --judge <model>', 'Judge model for synthesis')
    .option('-p, --provider <provider>', 'Provider (poe)')
    .option('-k, --api-key <key>', 'API key')
    .action(async (promptParts: string[], opts: { models?: string; judge?: string; provider?: string; apiKey?: string }) => {
      const prompt = promptParts.join(' ').trim()

      try {
        const config = resolveConfig({ cwd: process.cwd(), flags: buildMultiFlags(opts) })
        const resolved = resolveProvider(config)

        if (!resolved.baseURL) {
          printError('Multi-model requires proxy provider. Use -p poe or set POE_API_KEY.')
          process.exit(1)
        }

        const count = Math.min(parseInt(opts.models || '3', 10), 11)
        const models = pickDiverseModels(count)
        const judgeModel = opts.judge || models[0]!

        console.log()
        console.log(`\x1b[36m  ╭─────────────────────────────────────────────────╮\x1b[0m`)
        console.log(`\x1b[36m  │  Council Mode · ${models.length} models · judge: ${judgeModel.slice(0, 20).padEnd(20)}│\x1b[0m`)
        console.log(`\x1b[36m  ╰─────────────────────────────────────────────────╯\x1b[0m`)
        console.log()
        console.log(`\x1b[90m  prompt: ${prompt.slice(0, 70)}${prompt.length > 70 ? '...' : ''}\x1b[0m`)
        console.log()

        const result = await runCouncil({
          prompt,
          models,
          judgeModel,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          onModelStart: (m) => process.stdout.write(`  \x1b[90m● ${m}...\x1b[0m`),
          onModelDone: (_m, ms) => console.log(` \x1b[32m${(ms / 1000).toFixed(1)}s\x1b[0m`),
        })

        const md = new StreamMarkdown()

        // Show individual responses
        console.log()
        for (const r of result.responses) {
          if (r.error) {
            console.log(`\x1b[31m  ✗ ${r.model}: ${r.error}\x1b[0m\n`)
          } else {
            console.log(`\x1b[90m  ── ${r.model} (${(r.durationMs / 1000).toFixed(1)}s) ${'─'.repeat(Math.max(0, 40 - r.model.length))}──\x1b[0m`)
            md.push(r.text + '\n\n')
            md.flush()
          }
        }

        // Show verdict
        console.log(`\x1b[36m  ★ Verdict\x1b[0m \x1b[90m(${result.verdict.model} as judge, ${(result.verdict.durationMs / 1000).toFixed(1)}s)\x1b[0m\n`)
        md.push(result.verdict.text + '\n')
        md.flush()

        // Summary bar
        const totalCost = [...result.responses, result.verdict].reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)
        console.log()
        console.log(`\x1b[90m  ─ ${result.responses.length} models · ${(result.totalDurationMs / 1000).toFixed(1)}s · agreement: ${result.agreement} · ~${Math.round(totalCost / 1000)}K tokens ─\x1b[0m\n`)

      } catch (err) {
        printError(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}

// ── Race Command ─────────────────────────────────────────────────

export function createRaceCommand(): Command {
  return new Command('race')
    .description('Race multiple models — first good answer wins')
    .argument('<prompt...>', 'Question or task')
    .option('-n, --models <n>', 'Number of models to race', '5')
    .option('-p, --provider <provider>', 'Provider (poe)')
    .option('-k, --api-key <key>', 'API key')
    .action(async (promptParts: string[], opts: { models?: string; provider?: string; apiKey?: string }) => {
      const prompt = promptParts.join(' ').trim()

      try {
        const config = resolveConfig({ cwd: process.cwd(), flags: buildMultiFlags(opts) })
        const resolved = resolveProvider(config)

        if (!resolved.baseURL) {
          printError('Multi-model requires proxy provider. Use -p poe or set POE_API_KEY.')
          process.exit(1)
        }

        const count = Math.min(parseInt(opts.models || '5', 10), 11)
        const models = pickDiverseModels(count)

        console.log()
        console.log(`\x1b[33m  ╭─────────────────────────────────────────╮\x1b[0m`)
        console.log(`\x1b[33m  │  Race Mode · ${String(models.length).padStart(2)} models · first wins   │\x1b[0m`)
        console.log(`\x1b[33m  ╰─────────────────────────────────────────╯\x1b[0m`)
        console.log()

        const result = await runRace({
          prompt,
          models,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          onModelStart: (m) => process.stdout.write(`  \x1b[90m◎ ${m}...\x1b[0m`),
          onModelDone: (_m, ms, won) =>
            console.log(won ? ` \x1b[32m★ WINNER ${(ms / 1000).toFixed(1)}s\x1b[0m` : ` \x1b[90m${(ms / 1000).toFixed(1)}s\x1b[0m`),
        })

        const md = new StreamMarkdown()
        console.log()
        console.log(`\x1b[32m  ★ Winner: ${result.winner.model} (${(result.winner.durationMs / 1000).toFixed(1)}s)\x1b[0m\n`)
        md.push(result.winner.text + '\n')
        md.flush()

        if (result.cancelled.length > 0) {
          console.log(`\n\x1b[90m  cancelled: ${result.cancelled.join(', ')}\x1b[0m`)
        }
        console.log(`\x1b[90m  ─ ${(result.totalDurationMs / 1000).toFixed(1)}s total ─\x1b[0m\n`)

      } catch (err) {
        printError(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}

// ── Pipeline Command ─────────────────────────────────────────────

export function createPipelineCommand(): Command {
  return new Command('pipeline')
    .description('Chain models as specialists: plan → code → review')
    .argument('<prompt...>', 'Task description')
    .option('--plan <model>', 'Planner model', 'claude-opus-4.6')
    .option('--code <model>', 'Coder model', 'gpt-5.4')
    .option('--review <model>', 'Reviewer model', 'gemini-3.1-pro')
    .option('--stages <n>', 'Number of stages (3 or 5)', '3')
    .option('-p, --provider <provider>', 'Provider (poe)')
    .option('-k, --api-key <key>', 'API key')
    .action(async (promptParts: string[], opts: {
      plan?: string; code?: string; review?: string; stages?: string
      provider?: string; apiKey?: string
    }) => {
      const prompt = promptParts.join(' ').trim()

      try {
        const config = resolveConfig({ cwd: process.cwd(), flags: buildMultiFlags(opts) })
        const resolved = resolveProvider(config)

        if (!resolved.baseURL) {
          printError('Multi-model requires proxy provider. Use -p poe or set POE_API_KEY.')
          process.exit(1)
        }

        const stages: PipelineStage[] = [
          { role: 'plan', model: opts.plan || 'claude-opus-4.6' },
          { role: 'code', model: opts.code || 'gpt-5.4' },
          { role: 'review', model: opts.review || 'gemini-3.1-pro' },
        ]
        if (opts.stages === '5') {
          stages.push(
            { role: 'fix', model: opts.code || 'gpt-5.4' },
            { role: 'verify', model: opts.plan || 'claude-opus-4.6' },
          )
        }

        console.log()
        console.log(`\x1b[35m  ╭─────────────────────────────────────────────╮\x1b[0m`)
        console.log(`\x1b[35m  │  Pipeline Mode · ${stages.length} stages                    │\x1b[0m`)
        console.log(`\x1b[35m  │  ${stages.map(s => s.role).join(' → ').padEnd(43)}│\x1b[0m`)
        console.log(`\x1b[35m  ╰─────────────────────────────────────────────╯\x1b[0m`)
        console.log()

        const result = await runPipeline({
          prompt,
          stages,
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          onStageStart: (s, i) => process.stdout.write(`  \x1b[90m${i + 1}. ${s.role} (${s.model})...\x1b[0m`),
          onStageDone: (_s, _i, ms) => console.log(` \x1b[32m${(ms / 1000).toFixed(1)}s\x1b[0m`),
        })

        const md = new StreamMarkdown()
        console.log()
        for (const { stage, response } of result.stages) {
          console.log(`\x1b[90m  ── ${stage.role.toUpperCase()} · ${response.model} (${(response.durationMs / 1000).toFixed(1)}s) ──\x1b[0m`)
          if (response.error) {
            console.log(`\x1b[31m  error: ${response.error}\x1b[0m\n`)
          } else {
            md.push(response.text + '\n\n')
            md.flush()
          }
        }
        console.log(`\x1b[90m  ─ ${result.stages.length} stages · ${(result.totalDurationMs / 1000).toFixed(1)}s total ─\x1b[0m\n`)

      } catch (err) {
        printError(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}

// ── Helpers ──────────────────────────────────────────────────────

function buildMultiFlags(opts: { provider?: string; apiKey?: string }): Partial<ForgeConfig> {
  const flags: Partial<ForgeConfig> = {}
  if (opts.provider) flags.provider = opts.provider as ForgeConfig['provider']
  if (opts.apiKey) flags.apiKey = opts.apiKey
  return flags
}
