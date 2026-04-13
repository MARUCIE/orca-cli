/**
 * Round 28: Cognitive Skeleton + Token Estimation Tests
 *
 * Covers:
 *   1. Cognitive skeleton scenario matching — 12 tests
 *   2. CJK-aware token estimation — 6 tests
 */

import { describe, it, expect } from 'vitest'
import { matchCognitive, formatCognitiveContext, getFirstPrinciplesPrompt, listScenarios } from '../src/cognitive-skeleton.js'
import { estimateTokens } from '../src/token-budget.js'

// ── 1. Cognitive Skeleton ────────────────────────────────────────

describe('CognitiveSkeleton: scenario matching', () => {
  it('28.1 matches bug/error prompts to Defining Problems', () => {
    const match = matchCognitive('fix the bug in parser.ts')
    expect(match).not.toBeNull()
    expect(match!.scenario).toBe('Defining Problems')
    expect(match!.models.some(m => m.name === 'Inversion')).toBe(true)
    expect(match!.models.some(m => m.name === '5-Why')).toBe(true)
  })

  it('28.2 matches Chinese error prompts', () => {
    const match = matchCognitive('修复登录页面报错问题')
    expect(match).not.toBeNull()
    expect(match!.scenario).toBe('Defining Problems')
  })

  it('28.3 matches decision prompts to Making Decisions', () => {
    const match = matchCognitive('should we use Redis or Postgres for caching?')
    expect(match).not.toBeNull()
    expect(match!.scenario).toBe('Making Decisions')
    expect(match!.models.some(m => m.name === 'Second-Order Thinking')).toBe(true)
  })

  it('28.4 matches architecture prompts to Designing Systems', () => {
    const match = matchCognitive('refactor the authentication system')
    expect(match).not.toBeNull()
    expect(match!.scenario).toBe('Designing Systems')
    expect(match!.models.some(m => m.name === 'First Principles')).toBe(true)
  })

  it('28.5 matches security prompts to Evaluating Risk', () => {
    const match = matchCognitive('check for security vulnerabilities in the API')
    expect(match).not.toBeNull()
    expect(match!.scenario).toBe('Evaluating Risk')
  })

  it('28.6 matches performance prompts to Optimizing Performance', () => {
    const match = matchCognitive('optimize the database query latency')
    expect(match).not.toBeNull()
    expect(match!.scenario).toBe('Optimizing Performance')
    expect(match!.models.some(m => m.name === 'Pareto Principle')).toBe(true)
  })

  it('28.7 matches planning prompts to Planning Execution', () => {
    const match = matchCognitive('plan the v2.0 release deployment')
    expect(match).not.toBeNull()
    expect(match!.scenario).toBe('Planning Execution')
  })

  it('28.8 returns null for generic prompts', () => {
    const match = matchCognitive('hello')
    expect(match).toBeNull()
  })

  it('28.9 formatCognitiveContext produces structured output', () => {
    const match = matchCognitive('fix the crash on login')!
    const ctx = formatCognitiveContext(match)
    expect(ctx).toContain('[COGNITIVE]')
    expect(ctx).toContain('Defining Problems')
    expect(ctx).toContain('Inversion')
    expect(ctx).toContain('Instruction:')
  })

  it('28.10 getFirstPrinciplesPrompt returns non-empty', () => {
    const prompt = getFirstPrinciplesPrompt()
    expect(prompt.length).toBeGreaterThan(50)
    expect(prompt).toContain('decompose')
    expect(prompt).toContain('simplest')
  })

  it('28.11 listScenarios returns all 9 scenarios', () => {
    const scenarios = listScenarios()
    expect(scenarios.length).toBe(9)
    expect(scenarios.every(s => s.modelCount === 4)).toBe(true)
  })

  it('28.12 each scenario has 4 models with id, name, hint', () => {
    const match = matchCognitive('decide which option to choose')!
    for (const model of match.models) {
      expect(model.id).toBeTruthy()
      expect(model.name).toBeTruthy()
      expect(model.hint).toBeTruthy()
    }
  })
})

// ── 2. CJK-Aware Token Estimation ───────────────────────────────

describe('estimateTokens: CJK-aware estimation', () => {
  it('28.13 Latin text at ~4 chars/token', () => {
    const tokens = estimateTokens('Hello, world! This is a test string.')
    // 35 Latin chars → ceil(35/4) = 9
    expect(tokens).toBe(9)
  })

  it('28.14 CJK text at ~1.5 chars/token', () => {
    const tokens = estimateTokens('你好世界测试')
    // 6 CJK chars → ceil(6/1.5) = 4
    expect(tokens).toBe(4)
  })

  it('28.15 mixed CJK+Latin text', () => {
    const tokens = estimateTokens('Hello你好World世界')
    // 10 Latin chars → 10/4 = 2.5, 4 CJK chars → 4/1.5 ≈ 2.67 → ceil(5.17) = 6
    expect(tokens).toBe(6)
  })

  it('28.16 empty string returns 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('28.17 fullwidth forms count as CJK', () => {
    const tokens = estimateTokens('ＡＢＣ')  // fullwidth A, B, C
    // 3 fullwidth chars → ceil(3/1.5) = 2
    expect(tokens).toBe(2)
  })

  it('28.18 long Latin text scales correctly', () => {
    const text = 'a'.repeat(1000)
    const tokens = estimateTokens(text)
    // 1000 Latin chars → ceil(1000/4) = 250
    expect(tokens).toBe(250)
  })
})
