/**
 * `forge council` / `forge race` / `forge pipeline`
 *
 * Multi-model collaboration commands — the feature no single-vendor CLI can have.
 *
 * Routing strategy:
 *   - Aggregator available (Poe/OpenRouter): single endpoint → cross-vendor diversity
 *   - No aggregator: each model routes to its direct provider (Anthropic/OpenAI/Google)
 *
 * Usage:
 *   forge council "should we use SQL or NoSQL?"           # 3 models + judge
 *   forge race "write a CSV parser"                       # first model wins
 *   forge pipeline "build a REST API"                     # plan→code→review
 */

import { Command } from 'commander'
import { resolveConfig, resolveModelEndpoint, findAggregator, type ForgeConfig } from '../config.js'
import { printError } from '../output.js'
import { runCouncil, runRace, runPipeline, pickDiverseModels } from '../multi-model.js'
import { StreamMarkdown } from '../markdown.js'
import type { PipelineStage } from '../multi-model.js'

// ── Council Command ──────────────────────────────────────────────

export function createCouncilCommand(): Command {
  return new Command('council')
    .description('Ask multiple models the same question, synthesize the best answer')
    .argument('<prompt...>', 'Question or task')
    .option('-n, --models <n>', 'Number of models to consult', '3')
    .option('-j, --judge <model>', 'Judge model for synthesis')
    .option('-p, --provider <provider>', 'Aggregator provider (poe, openrouter)')
    .option('-k, --api-key <key>', 'API key')
    .action(async (promptParts: string[], opts: { models?: string; judge?: string; provider?: string; apiKey?: string }) => {
      const prompt = promptParts.join(' ').trim()

      try {
        const config = resolveConfig({ cwd: process.cwd(), flags: buildMultiFlags(opts) })
        // -p flag: if aggregator → use it; if direct provider → disable aggregator, use its models
        const explicitProvider = opts.provider
        const isExplicitAggregator = explicitProvider && config.providers[explicitProvider]?.aggregator
        const aggregatorId = explicitProvider
          ? (isExplicitAggregator ? explicitProvider : undefined)  // explicit non-aggregator → no aggregator
          : findAggregator(config)                                 // no -p → auto-detect

        // Pick models: aggregator → cross-vendor diversity, no aggregator → single-provider fallback
        const count = Math.min(parseInt(opts.models || '3', 10), 11)
        const singleProviderOverride = (explicitProvider && !isExplicitAggregator) ? explicitProvider : undefined
        const models = pickDiverseModels(count, aggregatorId ? undefined : getSingleProviderModels(config, singleProviderOverride))
        const judgeModel = opts.judge || models[0]!

        // Build resolver closure that routes each model
        const resolveEndpoint = (model: string) => resolveModelEndpoint(model, config, aggregatorId)

        // Verify at least one model is routable
        const testEndpoint = resolveEndpoint(models[0]!)
        if (!testEndpoint) {
          printError(
            `Cannot route model "${models[0]}". Configure an aggregator (Poe/OpenRouter) or direct provider API keys.\n` +
            `  forge council -p poe "..."      (aggregator)\n` +
            `  Set ANTHROPIC_API_KEY + OPENAI_API_KEY for direct routing`
          )
          process.exit(1)
        }

        const routeLabel = aggregatorId
          ? `via ${aggregatorId} (aggregator)`
          : 'direct routing'

        console.log()
        console.log(`\x1b[36m  ╭─────────────────────────────────────────────────╮\x1b[0m`)
        console.log(`\x1b[36m  │  Council Mode · ${models.length} models · judge: ${judgeModel.slice(0, 20).padEnd(20)}│\x1b[0m`)
        console.log(`\x1b[36m  ╰─────────────────────────────────────────────────╯\x1b[0m`)
        console.log(`\x1b[90m  ${routeLabel}\x1b[0m`)
        console.log()
        console.log(`\x1b[90m  prompt: ${prompt.slice(0, 70)}${prompt.length > 70 ? '...' : ''}\x1b[0m`)
        console.log()

        const result = await runCouncil({
          prompt,
          models,
          judgeModel,
          resolveEndpoint,
          onModelStart: (m) => process.stdout.write(`  \x1b[90m● ${m}...\x1b[0m`),
          onModelDone: (_m, ms) => console.log(` \x1b[32m${(ms / 1000).toFixed(1)}s\x1b[0m`),
        })

        const md = new StreamMarkdown()

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

        console.log(`\x1b[36m  ★ Verdict\x1b[0m \x1b[90m(${result.verdict.model} as judge, ${(result.verdict.durationMs / 1000).toFixed(1)}s)\x1b[0m\n`)
        md.push(result.verdict.text + '\n')
        md.flush()

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
    .option('-p, --provider <provider>', 'Aggregator provider')
    .option('-k, --api-key <key>', 'API key')
    .action(async (promptParts: string[], opts: { models?: string; provider?: string; apiKey?: string }) => {
      const prompt = promptParts.join(' ').trim()

      try {
        const config = resolveConfig({ cwd: process.cwd(), flags: buildMultiFlags(opts) })
        // -p flag: if aggregator → use it; if direct provider → disable aggregator, use its models
        const explicitProvider = opts.provider
        const isExplicitAggregator = explicitProvider && config.providers[explicitProvider]?.aggregator
        const aggregatorId = explicitProvider
          ? (isExplicitAggregator ? explicitProvider : undefined)  // explicit non-aggregator → no aggregator
          : findAggregator(config)                                 // no -p → auto-detect

        const count = Math.min(parseInt(opts.models || '5', 10), 11)
        const singleProviderOverride = (explicitProvider && !isExplicitAggregator) ? explicitProvider : undefined
        const models = pickDiverseModels(count, aggregatorId ? undefined : getSingleProviderModels(config, singleProviderOverride))
        const resolveEndpoint = (model: string) => resolveModelEndpoint(model, config, aggregatorId)

        const testEndpoint = resolveEndpoint(models[0]!)
        if (!testEndpoint) {
          printError('Cannot route models. Set up an aggregator or direct provider keys.')
          process.exit(1)
        }

        const routeLabel = aggregatorId ? `via ${aggregatorId}` : 'direct routing'

        console.log()
        console.log(`\x1b[33m  ╭─────────────────────────────────────────╮\x1b[0m`)
        console.log(`\x1b[33m  │  Race Mode · ${String(models.length).padStart(2)} models · first wins   │\x1b[0m`)
        console.log(`\x1b[33m  ╰─────────────────────────────────────────╯\x1b[0m`)
        console.log(`\x1b[90m  ${routeLabel}\x1b[0m`)
        console.log()

        const result = await runRace({
          prompt,
          models,
          resolveEndpoint,
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
    .option('-p, --provider <provider>', 'Aggregator provider')
    .option('-k, --api-key <key>', 'API key')
    .action(async (promptParts: string[], opts: {
      plan?: string; code?: string; review?: string; stages?: string
      provider?: string; apiKey?: string
    }) => {
      const prompt = promptParts.join(' ').trim()

      try {
        const config = resolveConfig({ cwd: process.cwd(), flags: buildMultiFlags(opts) })
        // -p flag: if aggregator → use it; if direct provider → disable aggregator, use its models
        const explicitProvider = opts.provider
        const isExplicitAggregator = explicitProvider && config.providers[explicitProvider]?.aggregator
        const aggregatorId = explicitProvider
          ? (isExplicitAggregator ? explicitProvider : undefined)  // explicit non-aggregator → no aggregator
          : findAggregator(config)                                 // no -p → auto-detect
        const resolveEndpoint = (model: string) => resolveModelEndpoint(model, config, aggregatorId)

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

        const routeLabel = aggregatorId ? `via ${aggregatorId}` : 'direct routing'

        console.log()
        console.log(`\x1b[35m  ╭─────────────────────────────────────────────╮\x1b[0m`)
        console.log(`\x1b[35m  │  Pipeline Mode · ${stages.length} stages                    │\x1b[0m`)
        console.log(`\x1b[35m  │  ${stages.map(s => s.role).join(' → ').padEnd(43)}│\x1b[0m`)
        console.log(`\x1b[35m  ╰─────────────────────────────────────────────╯\x1b[0m`)
        console.log(`\x1b[90m  ${routeLabel}\x1b[0m`)
        console.log()

        const result = await runPipeline({
          prompt,
          stages,
          resolveEndpoint,
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

/** Get model list from a specific or default provider (fallback when no aggregator) */
function getSingleProviderModels(config: ForgeConfig, overrideProviderId?: string): string[] | undefined {
  if (overrideProviderId) return config.providers[overrideProviderId]?.models
  const defaultId = config.defaultProvider === 'auto' ? undefined : config.defaultProvider
  if (defaultId) return config.providers[defaultId]?.models
  for (const [, pc] of Object.entries(config.providers)) {
    if (pc.models && pc.models.length > 0 && !pc.disabled) return pc.models
  }
  return undefined
}
