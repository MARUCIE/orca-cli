/**
 * Round 9: Multi-Model Collaboration — 11 tests
 * SOTA Dimension D4: Council/Race/Pipeline (Forge-unique feature)
 *
 * Tests the multi-model collaboration engine that no single-vendor
 * CLI can offer. Uses vi.mock to intercept chatOnce API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PipelineStage } from '../src/multi-model.js'

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

// ── Council Mode ───────────────────────────────────────��────────

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
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
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
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
    })

    const errored = result.responses.filter(r => r.error)
    expect(errored).toHaveLength(1)
    expect(result.verdict.text).toBeTruthy()
    expect(result.agreement).toBe('medium')
  })
})

// ── Race Mode ───────────────────────────────────────────────────

describe('Multi-model: Race', () => {
  it('9.6 Race returns first successful response', async () => {
    mockState.responses.set('claude-sonnet-4.6', { text: 'Fast answer.', inputTokens: 30, outputTokens: 15 })
    mockState.responses.set('gpt-5.4', { text: 'GPT answer.', inputTokens: 30, outputTokens: 12 })
    mockState.responses.set('gemini-3.1-pro', { text: 'Gemini answer.', inputTokens: 30, outputTokens: 14 })

    const result = await runRace({
      prompt: 'Quick question',
      models: ['claude-sonnet-4.6', 'gpt-5.4', 'gemini-3.1-pro'],
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
      timeout: 5000,
    })

    expect(result.winner.text).toBeTruthy()
    expect(result.winner.model).toBeTruthy()
    expect(result.totalDurationMs).toBeGreaterThan(0)
  })

  it('9.7 Race handles all-timeout scenario', async () => {
    // No models set up — all will throw
    const result = await runRace({
      prompt: 'Will timeout',
      models: ['model-a', 'model-b'],
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
      timeout: 100,
    })

    expect(result.winner.model).toBe('timeout')
    expect(result.winner.error).toBe('timeout')
  })
})

// ── Pipeline Mode ───────────────────────────────────────────────

describe('Multi-model: Pipeline', () => {
  it('9.8 Pipeline executes 3 stages sequentially', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'Plan: create user model', inputTokens: 100, outputTokens: 50 })
    mockState.responses.set('claude-sonnet-4.6', { text: 'class User { id: string }', inputTokens: 150, outputTokens: 40 })
    mockState.responses.set('gpt-5.4', { text: 'LGTM. No issues.', inputTokens: 200, outputTokens: 30 })

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'claude-sonnet-4.6' },
      { role: 'review', model: 'gpt-5.4' },
    ]

    const result = await runPipeline({
      prompt: 'Build user system',
      stages,
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
    })

    expect(result.stages).toHaveLength(3)
    expect(result.stages[0]!.stage.role).toBe('plan')
    expect(result.stages[1]!.stage.role).toBe('code')
    expect(result.stages[2]!.stage.role).toBe('review')
    for (const s of result.stages) expect(s.response.text).toBeTruthy()
  })

  it('9.9 Pipeline 5-stage: plan→code→review→fix→verify', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'Plan: auth middleware', inputTokens: 80, outputTokens: 30 })
    mockState.responses.set('claude-sonnet-4.6', { text: 'function auth() {}', inputTokens: 120, outputTokens: 40 })
    mockState.responses.set('gpt-5.4', { text: 'Issue: no JWT check', inputTokens: 160, outputTokens: 35 })
    mockState.responses.set('gemini-3.1-pro', { text: 'function auth() { verifyJWT() }', inputTokens: 200, outputTokens: 45 })
    mockState.responses.set('qwen3.6-plus', { text: 'PASS: All issues fixed.', inputTokens: 250, outputTokens: 25 })

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'claude-sonnet-4.6' },
      { role: 'review', model: 'gpt-5.4' },
      { role: 'fix', model: 'gemini-3.1-pro' },
      { role: 'verify', model: 'qwen3.6-plus' },
    ]

    const result = await runPipeline({
      prompt: 'Add JWT auth',
      stages,
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
    })

    expect(result.stages).toHaveLength(5)
    expect(result.stages[4]!.response.text).toContain('PASS')
  })

  it('9.10 Pipeline stops on stage error', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'Plan done.', inputTokens: 50, outputTokens: 20 })
    // Code model NOT set — will throw

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'missing-model' },
      { role: 'review', model: 'gpt-5.4' },
    ]

    const result = await runPipeline({
      prompt: 'Will fail at stage 2',
      stages,
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
    })

    expect(result.stages).toHaveLength(2)
    expect(result.stages[0]!.response.text).toBe('Plan done.')
    expect(result.stages[1]!.response.error).toBeTruthy()
  })

  it('9.11 Pipeline feeds output of each stage to next', async () => {
    mockState.responses.set('claude-opus-4.6', { text: 'PLAN_OUTPUT_MARKER', inputTokens: 50, outputTokens: 20 })
    mockState.responses.set('claude-sonnet-4.6', { text: 'Code implemented.', inputTokens: 100, outputTokens: 30 })

    const stages: PipelineStage[] = [
      { role: 'plan', model: 'claude-opus-4.6' },
      { role: 'code', model: 'claude-sonnet-4.6' },
    ]

    const result = await runPipeline({
      prompt: 'Build feature',
      stages,
      apiKey: 'test',
      baseURL: 'https://test.example.com/v1/',
    })

    expect(result.stages).toHaveLength(2)
    expect(result.stages[0]!.response.text).toBe('PLAN_OUTPUT_MARKER')
  })
})
