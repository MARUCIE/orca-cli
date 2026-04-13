/**
 * Multi-Model Collaboration Engine.
 *
 * Three modes no single-vendor CLI can ever have:
 *   1. Council — N models answer, judge synthesizes
 *   2. Race — N models race, first good answer wins
 *   3. Pipeline — chain models as specialists (plan → code → review)
 *
 * Routing strategy:
 *   - Aggregator available (Poe/OpenRouter): single endpoint, all models → cross-vendor diversity
 *   - Aggregator down: each model routes to its direct provider endpoint
 *   - resolveModelEndpoint() handles the routing per model
 */

import { chatOnce } from './providers/openai-compat.js'
import type { ModelEndpoint } from './config.js'

// ── Types ────────────────────────────────────────────────────────

export interface ModelResponse {
  model: string
  text: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  error?: string
}

export interface CouncilResult {
  responses: ModelResponse[]
  verdict: ModelResponse
  totalDurationMs: number
  agreement: 'high' | 'medium' | 'low'
}

export interface RaceResult {
  winner: ModelResponse
  cancelled: string[]
  totalDurationMs: number
}

export interface PipelineStage {
  role: 'plan' | 'code' | 'review' | 'fix' | 'verify' | 'custom'
  model: string
  label?: string
}

export interface PipelineResult {
  stages: Array<{ stage: PipelineStage; response: ModelResponse }>
  totalDurationMs: number
}

// ── Diversity Groups for Auto-Selection ──────────────────────────

const DIVERSITY_GROUPS: string[][] = [
  ['claude-opus-4.6', 'claude-sonnet-4.6'],
  ['gpt-5.4'],
  ['gemini-3.1-pro', 'gemini-3.1-flash-lite'],
  ['grok-4.20-multi-agent'],
  ['qwen3.6-plus'],
  ['kimi-k2.5'],
  ['glm-5'],
  ['gemma-4-31b'],
  ['minimax-m2.7'],
]

/**
 * Pick N diverse models.
 * If providerModels is given (single-provider fallback), pick from that list.
 * Otherwise fall back to DIVERSITY_GROUPS (cross-vendor selection).
 */
export function pickDiverseModels(count: number, providerModels?: string[]): string[] {
  // If provider declares its own model list, use that directly
  if (providerModels && providerModels.length > 0) {
    return providerModels.slice(0, count)
  }

  // Cross-vendor diversity: one per vendor family
  const picks: string[] = []
  for (const group of DIVERSITY_GROUPS) {
    if (picks.length >= count) break
    picks.push(group[0]!)
  }
  return picks.slice(0, count)
}

// ── Model Endpoint Helper ───────────────────────────────────────

/**
 * Call chatOnce with a resolved ModelEndpoint.
 * This is the single point where model→provider routing happens.
 */
async function callModel(endpoint: ModelEndpoint, prompt: string, signal?: AbortSignal) {
  return chatOnce(
    { apiKey: endpoint.apiKey, baseURL: endpoint.baseURL, model: endpoint.model },
    prompt,
    signal,
  )
}

// ── Council Mode ─────────────────────────────────────────────────

export async function runCouncil(opts: {
  prompt: string
  models: string[]
  judgeModel: string
  resolveEndpoint: (model: string) => ModelEndpoint | null
  onModelStart?: (model: string) => void
  onModelDone?: (model: string, durationMs: number) => void
}): Promise<CouncilResult> {
  const startTime = Date.now()
  const { prompt, models, judgeModel, resolveEndpoint, onModelStart, onModelDone } = opts

  // Phase 1: Query all models in parallel — each routes to its own provider
  const promises = models.map(async (model) => {
    onModelStart?.(model)
    const t0 = Date.now()

    const endpoint = resolveEndpoint(model)
    if (!endpoint) {
      const resp: ModelResponse = {
        model, text: '', durationMs: Date.now() - t0,
        inputTokens: 0, outputTokens: 0,
        error: `No provider endpoint found for model "${model}"`,
      }
      onModelDone?.(model, resp.durationMs)
      return resp
    }

    try {
      const result = await callModel(endpoint, prompt)
      const resp: ModelResponse = {
        model, text: result.text, durationMs: Date.now() - t0,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      }
      onModelDone?.(model, resp.durationMs)
      return resp
    } catch (err) {
      const resp: ModelResponse = {
        model, text: '', durationMs: Date.now() - t0,
        inputTokens: 0, outputTokens: 0,
        error: err instanceof Error ? err.message : String(err),
      }
      onModelDone?.(model, resp.durationMs)
      return resp
    }
  })

  const responses = await Promise.all(promises)
  const validResponses = responses.filter(r => !r.error && r.text)

  // Phase 2: Judge synthesizes
  const judgePrompt = buildJudgePrompt(prompt, validResponses)
  onModelStart?.(judgeModel + ' (judge)')
  const jt0 = Date.now()

  const judgeEndpoint = resolveEndpoint(judgeModel)
  let verdict: ModelResponse

  if (!judgeEndpoint) {
    verdict = {
      model: judgeModel, text: 'Judge error: no endpoint found',
      durationMs: Date.now() - jt0, inputTokens: 0, outputTokens: 0, error: 'no endpoint',
    }
  } else {
    try {
      const judgeResult = await callModel(judgeEndpoint, judgePrompt)
      verdict = {
        model: judgeModel, text: judgeResult.text, durationMs: Date.now() - jt0,
        inputTokens: judgeResult.inputTokens, outputTokens: judgeResult.outputTokens,
      }
    } catch (err) {
      verdict = {
        model: judgeModel,
        text: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - jt0, inputTokens: 0, outputTokens: 0, error: String(err),
      }
    }
  }
  onModelDone?.(judgeModel + ' (judge)', verdict.durationMs)

  const agreement = validResponses.length <= 1 ? 'low'
    : validResponses.length === models.length ? 'high'
    : 'medium'

  return { responses, verdict, totalDurationMs: Date.now() - startTime, agreement }
}

function buildJudgePrompt(originalPrompt: string, responses: ModelResponse[]): string {
  const modelAnswers = responses.map((r, i) =>
    `### Model ${i + 1}: ${r.model} (${(r.durationMs / 1000).toFixed(1)}s)\n\n${r.text}`
  ).join('\n\n---\n\n')

  return `You are a judge synthesizing answers from ${responses.length} different AI models.

## Original Question
${originalPrompt}

## Model Answers

${modelAnswers}

## Your Task

Synthesize the best answer by:
1. Identify points where all models **agree** (high confidence)
2. Identify points where models **disagree** (flag with reasoning)
3. Produce a **final recommendation** that takes the best from each
4. Rate overall **confidence**: HIGH (all agree), MEDIUM (mostly agree), LOW (significant disagreement)

Be concise and actionable. Lead with the recommendation, then explain differences.`
}

// ── Race Mode ────────────────────────────────────────────────────

export async function runRace(opts: {
  prompt: string
  models: string[]
  resolveEndpoint: (model: string) => ModelEndpoint | null
  timeout?: number
  onModelStart?: (model: string) => void
  onModelDone?: (model: string, durationMs: number, won: boolean) => void
}): Promise<RaceResult> {
  const startTime = Date.now()
  const { prompt, models, resolveEndpoint, timeout = 30_000, onModelStart, onModelDone } = opts

  const abortControllers = models.map(() => new AbortController())
  const cancelled: string[] = []

  const result = await new Promise<ModelResponse>((resolveRace) => {
    let resolved = false

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        resolveRace({
          model: 'timeout', text: 'All models timed out.',
          durationMs: timeout, inputTokens: 0, outputTokens: 0, error: 'timeout',
        })
      }
    }, timeout)

    models.forEach(async (model, idx) => {
      onModelStart?.(model)
      const t0 = Date.now()

      const endpoint = resolveEndpoint(model)
      if (!endpoint) {
        onModelDone?.(model, Date.now() - t0, false)
        return
      }

      try {
        const result = await callModel(endpoint, prompt, abortControllers[idx]!.signal)
        const resp: ModelResponse = {
          model, text: result.text, durationMs: Date.now() - t0,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        }

        if (!resolved && resp.text) {
          resolved = true
          clearTimeout(timeoutId)
          onModelDone?.(model, resp.durationMs, true)
          abortControllers.forEach((ac, i) => {
            if (i !== idx) { ac.abort(); cancelled.push(models[i]!) }
          })
          resolveRace(resp)
        } else {
          onModelDone?.(model, Date.now() - t0, false)
        }
      } catch {
        onModelDone?.(model, Date.now() - t0, false)
      }
    })
  })

  return { winner: result, cancelled, totalDurationMs: Date.now() - startTime }
}

// ── Pipeline Mode ────────────────────────────────────────────────

const STAGE_PROMPTS: Record<string, string> = {
  plan: 'You are a software architect. Create a detailed implementation plan for the following task. Be specific about files, functions, and data flow. Do NOT write code yet.\n\nTask: ',
  code: 'You are a fast, precise coder. Implement the following plan. Write clean, minimal code.\n\nPlan:\n',
  review: 'You are a senior code reviewer. Review the following code for bugs, security issues, performance problems, and style. List specific issues with line references.\n\nCode to review:\n',
  fix: 'Fix ALL issues identified in the review. Show only the corrected code.\n\nReview findings:\n',
  verify: 'Verify that the implementation matches the original plan and all review issues are fixed. Report: PASS or FAIL with specific reasons.\n\nOriginal plan:\n',
  custom: '',
}

export async function runPipeline(opts: {
  prompt: string
  stages: PipelineStage[]
  resolveEndpoint: (model: string) => ModelEndpoint | null
  onStageStart?: (stage: PipelineStage, index: number) => void
  onStageDone?: (stage: PipelineStage, index: number, durationMs: number) => void
}): Promise<PipelineResult> {
  const startTime = Date.now()
  const { prompt, stages, resolveEndpoint, onStageStart, onStageDone } = opts

  const results: Array<{ stage: PipelineStage; response: ModelResponse }> = []
  let previousOutput = prompt

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!
    onStageStart?.(stage, i)
    const t0 = Date.now()

    const endpoint = resolveEndpoint(stage.model)
    if (!endpoint) {
      results.push({
        stage,
        response: {
          model: stage.model, text: '', durationMs: Date.now() - t0,
          inputTokens: 0, outputTokens: 0,
          error: `No endpoint for model "${stage.model}"`,
        },
      })
      onStageDone?.(stage, i, Date.now() - t0)
      break
    }

    const stagePrompt = (STAGE_PROMPTS[stage.role] || '') + previousOutput

    try {
      const result = await callModel(endpoint, stagePrompt)
      const resp: ModelResponse = {
        model: stage.model, text: result.text, durationMs: Date.now() - t0,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      }
      results.push({ stage, response: resp })
      previousOutput = result.text
      onStageDone?.(stage, i, resp.durationMs)
    } catch (err) {
      results.push({
        stage,
        response: {
          model: stage.model, text: '', durationMs: Date.now() - t0,
          inputTokens: 0, outputTokens: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      })
      onStageDone?.(stage, i, Date.now() - t0)
      break
    }
  }

  return { stages: results, totalDurationMs: Date.now() - startTime }
}
