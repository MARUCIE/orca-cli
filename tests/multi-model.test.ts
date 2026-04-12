/**
 * Round 9: Multi-Model Collaboration — 11 tests
 * SOTA Dimension D4: Council/Race/Pipeline (Orca-unique feature)
 *
 * Tests the multi-model collaboration engine that no single-vendor
 * CLI can offer. Uses vi.mock to intercept chatOnce API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PipelineStage } from '../src/multi-model.js'
import type { ModelEndpoint } from '../src/config.js'

// ── Mock Setup ──────────────────────────────────────────────────

const mockState = vi.hoisted(() => {
  const responses = new Map<string, { text: string; inputTokens: number; outputTokens: number }>()
  return { responses }
})

vi.mock('../src/providers/openai-compat.js', () => ({
  chatOnce: async (opts: { model: string }) => {
    const response = mockState.responses.get(opts.model)
    if (!response) throw new Error(`No mock response for model: ${opts.model}`)
    await new Promise(r => setTimeout(r, 10))
    return response
  },
}))

import { pickDiverseModels, runCouncil, runRace, runPipeline } from '../src/multi-model.js'

beforeEach(() => {
  mockState.responses.clear()
})

// Helper: create a resolveEndpoint that always returns a test endpoint
function mockResolveEndpoint(model: string): ModelEndpoint | null {
  return { model, apiKey: 'test', baseURL: 'https://test.example.com/v1/', provider: 'test' }
}

// ── Diversity Selection ─────────────────────────────────────────

describe('Multi-model: Diversity selection', () => {
  it('9.1 pickDiverseModels returns models from different vendors', () => {
    const models = pickDiverseModels(3)
    expect(models).toHaveLength(3)
    const unique = new Set(models)
    expect(unique.size).toBe(3)
    expect(models[0]).toContain('claude')
  })

  it('9.2 pickDiverseModels covers max vendor diversity', () => {
    const models = pickDiverseModels(9)
    expect(models).toHaveLength(9)
    expect(new Set(models).size).toBe(9)
  })

  it('9.3 pickDiverseModels respects count limit', () => {
    expect(pickDiverseModels(2)).toHaveLength(2)
    expect(pickDiverseModels(20).length).toBeLessThanOrEqual(9)
  })
})

// ── Council Mode ─────────────────────────────────────────────────

describe('Multi-model: Council', () => {
  it('9.4 Council queries all models and produces judge verdict', async () => {
    mockState.responses.set('claude-sonnet-4.6', { text: 'Use React.', inputTokens: 50, outputTokens: 30 })
    mockState.responses.set('gpt-5.4', { text: 'React is best.', inputTokens: 50, outputTokens: 25 })
    mockState.responses.set('gemini-3.1-pro', { text: 'I recommend React.', inputTokens: 50, outputTokens: 28 })
    mockState.responses.set('claude-opus-4.6', { text: 'All agree: React. Confidence: HIGH.', inputTokens: 200, outputTokens: 40 })

    const result = await runCouncil({
      prompt: 'What framework?',
      models: ['claude-sonnet-4.6', 'gpt-5.4', 'gemini-3.1-pro'],
      judgeModel: 'claude-opus-4.6',
      resolveEndpoint: mockResolveEndpoint,
    })

    expect(result.responses).toHaveLength(3)
    expect(result.verdict.text).toContain('React')
    expect(result.agreement).toBe('high')
    expect(result.totalDurationMs).toBeGreaterThan(0)
  })

  it('9.5 Council handles model error gracefully', async () => {
    mockState.responses.set('claude-sonnet-4.6', { text: 'Valid response.', inputTokens: 50, outputTokens: 20 })
    // gpt-5.4 NOT set — will throw
    mockState.responses.set('gemini-3.1-pro', { text: 'Another valid.', inputTokens: 50, outputTokens: 22 })
    mockState.responses.set('claude-opus-4.6', { text: 'Synthesized from 2.', inputTokens: 100, outputTokens: 30 })

    const result = await runCouncil({
      prompt: 'Test with failure',
      models: ['claude-sonnet-4.6', 'gpt-5.4', 'gemini-3.1-pro'],
      judgeModel: 'claude-opus-4.6',
      resolveEndpoint: mockResolveEndpoint,
    })

    const errored = result.responses.filter(r => r.error)
    expect(errored).toHaveLength(1)
    expect(result.verdict.text).toBeTruthy()
    expect(result.agreement).toBe('medium')
  })
})

// ── Race Mode ────────────────────────────────────────────────────

describe('Multi-model: Race', () => {
  it('9.6 Race returns first successful response', async () => {
    mockState.responses.set('claude-sonnet-4.6', { text: 'Claude wins!', inputTokens: 50, outputTokens: 15 })
    mockState.responses.set('gpt-5.4', { text: 'GPT answer', inputTokens: 50, outputTokens: 12 })

    const result = await runRace({
      prompt: 'Quick answer',
      models: ['claude-sonnet-4.6', 'gpt-5.4'],
      resolveEndpoint: mockResolveEndpoint,
      timeout: 5000,
    })

    expect(result.winner).toBeDefined()
    expect(result.winner.text).toBeTruthy()
    expect(result.totalDurationMs).toBeGreaterThan(0)
  })

  it('9.7 Race cancels remaining after winner', async () => {
    mockState.responses.set('claude-sonnet-4.6', { text: 'Winner', inputTokens: 30, outputTokens: 10 })
    mockState.responses.set('gpt-5.4', { text: 'Also ran', inputTokens: 30, outputTokens: 10 })

    const result = await runRace({
      prompt: 'Race them',
      models: ['claude-sonnet-4.6', 'gpt-5.4'],
      resolveEndpoint: mockResolveEndpoint,
      timeout: 5000,
    })

    expect(result.winner.text).toBeTruthy()
  })
})

// ── Pipeline Mode ────────────────────────────────────────────────

describe('Multi-model: Pipeline', () => {
  it('9.8 Pipeline executes 3 stages sequentially', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'Plan: build API with Express.', inputTokens: 80, outputTokens: 40 })
    mockState.responses.set('gpt-5.4', { text: 'const app = express();', inputTokens: 100, outputTokens: 60 })
    mockState.responses.set('gemini-3.1-pro', { text: 'Looks good. No issues.', inputTokens: 120, outputTokens: 20 })

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'gpt-5.4' },
      { role: 'review', model: 'gemini-3.1-pro' },
    ]

    const result = await runPipeline({
      prompt: 'Build REST API',
      stages,
      resolveEndpoint: mockResolveEndpoint,
    })

    expect(result.stages).toHaveLength(3)
    expect(result.stages[0]!.response.text).toContain('Express')
    expect(result.stages[2]!.response.text).toContain('good')
  })

  it('9.9 Pipeline 5-stage: plan→code→review→fix→verify', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'Plan step', inputTokens: 50, outputTokens: 30 })
    mockState.responses.set('gpt-5.4', { text: 'Code step', inputTokens: 60, outputTokens: 50 })
    mockState.responses.set('gemini-3.1-pro', { text: 'Review: found 1 issue', inputTokens: 70, outputTokens: 20 })

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'gpt-5.4' },
      { role: 'review', model: 'gemini-3.1-pro' },
      { role: 'fix', model: 'gpt-5.4' },
      { role: 'verify', model: 'claude-opus-4.6' },
    ]

    const result = await runPipeline({
      prompt: 'Refactor to TypeScript',
      stages,
      resolveEndpoint: mockResolveEndpoint,
    })

    expect(result.stages).toHaveLength(5)
  })

  it('9.10 Pipeline stops on stage error', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'Plan done', inputTokens: 50, outputTokens: 20 })
    // gpt-5.4 NOT set — code stage will fail

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'gpt-5.4' },
      { role: 'review', model: 'gemini-3.1-pro' },
    ]

    const result = await runPipeline({
      prompt: 'Will fail at code stage',
      stages,
      resolveEndpoint: mockResolveEndpoint,
    })

    expect(result.stages).toHaveLength(2) // stops after failed code stage
    expect(result.stages[1]!.response.error).toBeTruthy()
  })

  it('9.11 Pipeline feeds output of each stage to next', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'UNIQUE_PLAN_OUTPUT', inputTokens: 50, outputTokens: 30 })
    mockState.responses.set('gpt-5.4', { text: 'Code based on plan', inputTokens: 80, outputTokens: 50 })
    mockState.responses.set('gemini-3.1-pro', { text: 'Reviewed', inputTokens: 90, outputTokens: 15 })

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'gpt-5.4' },
      { role: 'review', model: 'gemini-3.1-pro' },
    ]

    const result = await runPipeline({
      prompt: 'Build parser',
      stages,
      resolveEndpoint: mockResolveEndpoint,
    })

    expect(result.stages[0]!.response.text).toBe('UNIQUE_PLAN_OUTPUT')
    expect(result.stages).toHaveLength(3)
  })
})
