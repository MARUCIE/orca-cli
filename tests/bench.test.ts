/**
 * Round 16: Benchmark Self-Evaluation — 10 tests
 *
 * Tests the benchmark runner and all 5 built-in scenarios.
 * This is the meta-test: testing the thing that tests the agent.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { SCENARIOS, runScenario, runSuite } from '../src/bench/scenarios.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const baseDir = join(tmpdir(), `forge-bench-test-${Date.now()}`)

afterAll(() => {
  try { rmSync(baseDir, { recursive: true, force: true }) } catch { /* */ }
})

// ── Scenario Registry ───────────────────────────────────────────

describe('Benchmark: scenario registry', () => {
  it('16.1 has exactly 5 built-in scenarios', () => {
    expect(SCENARIOS).toHaveLength(5)
  })

  it('16.2 all scenarios have required fields', () => {
    for (const s of SCENARIOS) {
      expect(s.id).toBeTruthy()
      expect(s.name).toBeTruthy()
      expect(s.category).toBeTruthy()
      expect(s.difficulty).toBeTruthy()
      expect(typeof s.setup).toBe('function')
      expect(typeof s.verify).toBe('function')
      expect(s.steps.length).toBeGreaterThan(0)
    }
  })

  it('16.3 scenario IDs are unique', () => {
    const ids = SCENARIOS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('16.4 covers all difficulty levels', () => {
    const difficulties = new Set(SCENARIOS.map(s => s.difficulty))
    expect(difficulties.has('easy')).toBe(true)
    expect(difficulties.has('medium')).toBe(true)
    expect(difficulties.has('hard')).toBe(true)
  })
})

// ── Individual Scenarios ────────────────────────────────────────

describe('Benchmark: individual scenarios pass', () => {
  it('16.5 S1: SQL injection fix passes', () => {
    const result = runScenario(SCENARIOS[0]!, baseDir)
    expect(result.passed).toBe(true)
    expect(result.stepsFailed).toBe(0)
  })

  it('16.6 S2: Pagination feature passes', () => {
    const result = runScenario(SCENARIOS[1]!, baseDir)
    expect(result.passed).toBe(true)
  })

  it('16.7 S3: Extract interface passes', () => {
    const result = runScenario(SCENARIOS[2]!, baseDir)
    expect(result.passed).toBe(true)
  })

  it('16.8 S4: Off-by-one fix passes', () => {
    const result = runScenario(SCENARIOS[3]!, baseDir)
    expect(result.passed).toBe(true)
  })

  it('16.9 S5: Large file navigation passes', () => {
    const result = runScenario(SCENARIOS[4]!, baseDir)
    expect(result.passed).toBe(true)
  })
})

// ── Suite Runner ────────────────────────────────────────────────

describe('Benchmark: suite runner', () => {
  it('16.10 full suite scores 100%', () => {
    const suiteDir = join(baseDir, 'full-suite')
    mkdirSync(suiteDir, { recursive: true })

    const { results, score, totalMs } = runSuite(SCENARIOS, suiteDir)

    expect(results).toHaveLength(5)
    expect(score).toBe(100)
    expect(totalMs).toBeGreaterThan(0)

    // All passed
    for (const r of results) {
      expect(r.passed).toBe(true)
    }
  })
})
