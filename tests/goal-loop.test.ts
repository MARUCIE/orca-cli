/**
 * Round 30: Goal-Loop Controller + Sub-Agent Safety — 16 tests
 *
 * Covers:
 *   1. Done-criteria parsing — 6 tests
 *   2. Criteria evaluation — 4 tests
 *   3. Goal-loop execution — 6 tests
 */

import { describe, it, expect } from 'vitest'
import { parseDoneCriteria, evaluateCriteria, runGoalLoop } from '../src/harness/goal-loop.js'
import type { DoneCriteria, GoalLoopConfig } from '../src/harness/goal-loop.js'

// ── 1. Done-Criteria Parsing ─────────────────────────────────────

describe('parseDoneCriteria: natural language → structured criteria', () => {
  it('30.1 "tests pass" → command: npm test', () => {
    const c = parseDoneCriteria('tests pass')
    expect(c.type).toBe('command')
    expect(c.value).toBe('npm test')
  })

  it('30.2 "lint clean" → command: npm run lint', () => {
    const c = parseDoneCriteria('lint clean')
    expect(c.type).toBe('command')
    expect(c.value).toBe('npm run lint')
  })

  it('30.3 "typecheck passes" → command: npx tsc --noEmit', () => {
    const c = parseDoneCriteria('typecheck passes')
    expect(c.type).toBe('command')
    expect(c.value).toBe('npx tsc --noEmit')
  })

  it('30.4 "/pattern/" → regex', () => {
    const c = parseDoneCriteria('/all tests passed/')
    expect(c.type).toBe('regex')
    expect(c.value).toBe('all tests passed')
  })

  it('30.5 "exit 0: make build" → command: make build', () => {
    const c = parseDoneCriteria('exit 0: make build')
    expect(c.type).toBe('command')
    expect(c.value).toBe('make build')
  })

  it('30.6 arbitrary string → regex fallback', () => {
    const c = parseDoneCriteria('DONE')
    expect(c.type).toBe('regex')
    expect(c.value).toBe('DONE')
  })
})

// ── 2. Criteria Evaluation ───────────────────────────────────────

describe('evaluateCriteria: check conditions', () => {
  it('30.7 regex matches in agent output', async () => {
    const criteria: DoneCriteria = { type: 'regex', value: 'all.*passed' }
    const result = await evaluateCriteria(criteria, 'Output: all 5 tests passed!', '/tmp')
    expect(result.passed).toBe(true)
  })

  it('30.8 regex does not match', async () => {
    const criteria: DoneCriteria = { type: 'regex', value: 'PASS' }
    const result = await evaluateCriteria(criteria, 'All tests FAILED', '/tmp')
    expect(result.passed).toBe(false)
  })

  it('30.9 command succeeds (echo exits 0)', async () => {
    const criteria: DoneCriteria = { type: 'command', value: 'echo ok' }
    const result = await evaluateCriteria(criteria, '', '/tmp')
    expect(result.passed).toBe(true)
    expect(result.output).toContain('ok')
  })

  it('30.10 command fails (false exits 1)', async () => {
    const criteria: DoneCriteria = { type: 'command', value: 'false' }
    const result = await evaluateCriteria(criteria, '', '/tmp')
    expect(result.passed).toBe(false)
  })
})

// ── 3. Goal-Loop Execution ───────────────────────────────────────

describe('runGoalLoop: criteria-driven autonomous execution', () => {
  it('30.11 succeeds on first iteration when criteria met', async () => {
    const config: GoalLoopConfig = {
      maxIterations: 5,
      doneCriteria: { type: 'regex', value: 'DONE' },
      cwd: '/tmp',
    }
    const result = await runGoalLoop(config, async () => 'Task DONE successfully')
    expect(result.success).toBe(true)
    expect(result.iterations).toBe(1)
    expect(result.reason).toBe('criteria_met')
  })

  it('30.12 succeeds on third iteration', async () => {
    let call = 0
    const config: GoalLoopConfig = {
      maxIterations: 5,
      doneCriteria: { type: 'regex', value: 'COMPLETE' },
      cwd: '/tmp',
    }
    const result = await runGoalLoop(config, async () => {
      call++
      return call >= 3 ? 'Task COMPLETE' : 'Still working...'
    })
    expect(result.success).toBe(true)
    expect(result.iterations).toBe(3)
  })

  it('30.13 stops at max iterations', async () => {
    let call = 0
    const config: GoalLoopConfig = {
      maxIterations: 2,  // 2 iterations: failure 1 (continue) + failure 2 (pivot) → hits max before escalate at 3
      doneCriteria: { type: 'regex', value: 'IMPOSSIBLE' },
      cwd: '/tmp',
    }
    const result = await runGoalLoop(config, async () => {
      call++
      return `Attempt ${call}: different progress`
    })
    expect(result.success).toBe(false)
    expect(result.iterations).toBe(2)
    expect(result.reason).toBe('max_iterations')
  })

  it('30.14 detects stuck and escalates', async () => {
    const config: GoalLoopConfig = {
      maxIterations: 10,
      doneCriteria: { type: 'regex', value: 'DONE' },
      cwd: '/tmp',
    }
    // Same failure message every time triggers loop detector
    const result = await runGoalLoop(config, async () => 'Same error')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('stuck')
    expect(result.iterations).toBeLessThanOrEqual(4) // 3 failures → escalate
  })

  it('30.15 handles error in iteration', async () => {
    const config: GoalLoopConfig = {
      maxIterations: 5,
      doneCriteria: { type: 'regex', value: 'DONE' },
      cwd: '/tmp',
    }
    const result = await runGoalLoop(config, async () => {
      throw new Error('API timeout')
    })
    expect(result.success).toBe(false)
    expect(result.reason).toBe('error')
    expect(result.lastOutput).toContain('API timeout')
  })

  it('30.16 passes feedback from previous iteration', async () => {
    const feedbacks: Array<string | undefined> = []
    const config: GoalLoopConfig = {
      maxIterations: 3,
      doneCriteria: { type: 'regex', value: 'DONE' },
      cwd: '/tmp',
    }
    let call = 0
    await runGoalLoop(config, async (_i, feedback) => {
      feedbacks.push(feedback)
      call++
      return call >= 3 ? 'DONE' : 'not yet'
    })
    expect(feedbacks[0]).toBeUndefined() // first iteration has no feedback
    expect(feedbacks[1]).toContain('did not meet criteria')
  })
})

// ── 4. Deep Edge Cases ─────────────────────────────────────────────

describe('parseDoneCriteria - edge cases', () => {
  it('handles "build passes" case insensitive', () => {
    const c = parseDoneCriteria('Build Passes')
    expect(c.type).toBe('command')
    expect(c.value).toBe('npm run build')
  })

  it('handles "type check" two words', () => {
    const c = parseDoneCriteria('type check')
    expect(c.type).toBe('command')
    expect(c.value).toBe('npx tsc --noEmit')
  })

  it('trims leading/trailing whitespace', () => {
    const c = parseDoneCriteria('   lint passes   ')
    expect(c.type).toBe('command')
  })

  it('single "/" is not parsed as regex', () => {
    const c = parseDoneCriteria('/')
    expect(c.type).toBe('regex') // fallback to default regex
    expect(c.value).toBe('/')
  })

  it('"exit 0:" with complex command', () => {
    const c = parseDoneCriteria('exit 0: docker compose up -d && curl localhost:3000')
    expect(c.type).toBe('command')
    expect(c.value).toContain('docker compose')
  })
})

describe('evaluateCriteria - edge cases', () => {
  it('regex with special characters in pattern', async () => {
    const criteria: DoneCriteria = { type: 'regex', value: '\\d+ tests? passed' }
    const result = await evaluateCriteria(criteria, '42 tests passed', '/tmp')
    expect(result.passed).toBe(true)
  })

  it('regex is case insensitive (flag i)', async () => {
    const criteria: DoneCriteria = { type: 'regex', value: 'pass' }
    const result = await evaluateCriteria(criteria, 'PASS', '/tmp')
    expect(result.passed).toBe(true)
  })

  it('invalid regex returns graceful error', async () => {
    const criteria: DoneCriteria = { type: 'regex', value: '[unclosed(' }
    const result = await evaluateCriteria(criteria, 'test', '/tmp')
    expect(result.passed).toBe(false)
    expect(result.output).toContain('Invalid regex')
  })

  it('command captures stdout on success', async () => {
    const criteria: DoneCriteria = { type: 'command', value: 'echo "hello world"' }
    const result = await evaluateCriteria(criteria, '', '/tmp')
    expect(result.passed).toBe(true)
    expect(result.output).toContain('hello world')
  })

  it('command truncates long output', async () => {
    const criteria: DoneCriteria = { type: 'command', value: `printf '${'X'.repeat(600)}'` }
    const result = await evaluateCriteria(criteria, '', '/tmp')
    expect(result.output.length).toBeLessThanOrEqual(500)
  })

  it('judge without apiOptions returns clear error', async () => {
    const criteria: DoneCriteria = { type: 'judge', value: 'Is the code correct?' }
    const result = await evaluateCriteria(criteria, 'some output', '/tmp')
    expect(result.passed).toBe(false)
    expect(result.output).toContain('requires apiOptions')
  })
})

describe('runGoalLoop - callbacks', () => {
  it('calls onIterationStart with correct iteration numbers', async () => {
    const starts: [number, number][] = []
    const config: GoalLoopConfig = {
      maxIterations: 5,
      doneCriteria: { type: 'regex', value: 'ok' },
      cwd: '/tmp',
      onIterationStart: (i, max) => starts.push([i, max]),
    }

    let n = 0
    await runGoalLoop(config, async () => {
      n++
      return n >= 2 ? 'ok' : 'nope'
    })

    expect(starts).toEqual([[1, 5], [2, 5]])
  })

  it('calls onIterationDone with pass/fail result', async () => {
    const dones: [number, boolean][] = []
    const config: GoalLoopConfig = {
      maxIterations: 5,
      doneCriteria: { type: 'regex', value: 'PASS' },
      cwd: '/tmp',
      onIterationDone: (i, passed) => dones.push([i, passed]),
    }

    let n = 0
    await runGoalLoop(config, async () => {
      n++
      return n >= 3 ? 'PASS' : 'fail'
    })

    expect(dones[0]).toEqual([1, false])
    expect(dones[1]).toEqual([2, false])
    expect(dones[2]).toEqual([3, true])
  })

  it('calls onComplete with final result', async () => {
    let final: GoalLoopResult | null = null
    const config: GoalLoopConfig = {
      maxIterations: 1,
      doneCriteria: { type: 'regex', value: 'done' },
      cwd: '/tmp',
      onComplete: (r) => { final = r },
    }

    await runGoalLoop(config, async () => 'done')
    expect(final).toBeTruthy()
    expect(final!.success).toBe(true)
    expect(final!.reason).toBe('criteria_met')
  })

  it('onComplete called on error too', async () => {
    let final: GoalLoopResult | null = null
    const config: GoalLoopConfig = {
      maxIterations: 3,
      doneCriteria: { type: 'regex', value: 'x' },
      cwd: '/tmp',
      onComplete: (r) => { final = r },
    }

    await runGoalLoop(config, async () => { throw new Error('boom') })
    expect(final!.success).toBe(false)
    expect(final!.reason).toBe('error')
  })
})

describe('runGoalLoop - command criteria in loop', () => {
  it('uses real shell command to check done condition', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = join(tmpdir(), `gl-cmd-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    const marker = join(dir, 'done.txt')
    const config: GoalLoopConfig = {
      maxIterations: 5,
      doneCriteria: { type: 'command', value: `test -f "${marker}"` },
      cwd: dir,
    }

    let n = 0
    const result = await runGoalLoop(config, async () => {
      n++
      if (n === 2) writeFileSync(marker, 'ok')
      return `iter ${n}`
    })

    expect(result.success).toBe(true)
    expect(result.iterations).toBe(2)

    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })
})

describe('runGoalLoop - duration tracking', () => {
  it('records totalDurationMs', async () => {
    const config: GoalLoopConfig = {
      maxIterations: 1,
      doneCriteria: { type: 'regex', value: 'x' },
      cwd: '/tmp',
    }
    const result = await runGoalLoop(config, async () => 'x')
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.totalDurationMs).toBe('number')
  })
})
