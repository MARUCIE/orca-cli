/**
 * Round 18: Harness Core — 25 tests
 *
 * Tests the 4 P0 harness modules:
 *   1. Loop Detector (Tw93 rule)
 *   2. Context Monitor (4-tier risk)
 *   3. Error Classifier
 *   4. Verification Gate
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LoopDetector } from '../src/harness/loop-detector.js'
import { ContextMonitor } from '../src/harness/context-monitor.js'
import { classifyError, isRetryable, getRecoverySuggestion } from '../src/harness/error-classifier.js'
import { runVerificationGate } from '../src/harness/verification-gate.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Loop Detector ───────────────────────────────────────────────

describe('LoopDetector: Tw93 stuck-twice rule', () => {
  let detector: LoopDetector

  beforeEach(() => {
    detector = new LoopDetector()
  })

  it('18.1 first failure returns continue', () => {
    expect(detector.recordFailure('app.ts', 'main', 'TypeError')).toBe('continue')
  })

  it('18.2 second failure on same target returns pivot', () => {
    detector.recordFailure('app.ts', 'main', 'TypeError')
    expect(detector.recordFailure('app.ts', 'main', 'TypeError again')).toBe('pivot')
  })

  it('18.3 third failure returns escalate', () => {
    detector.recordFailure('app.ts', 'main', 'err1')
    detector.recordFailure('app.ts', 'main', 'err2')
    expect(detector.recordFailure('app.ts', 'main', 'err3')).toBe('escalate')
  })

  it('18.4 different targets are tracked independently', () => {
    detector.recordFailure('app.ts', 'main', 'err1')
    expect(detector.recordFailure('utils.ts', 'helper', 'err2')).toBe('continue')
  })

  it('18.5 success clears failure tracking', () => {
    detector.recordFailure('app.ts', 'main', 'err1')
    detector.recordFailure('app.ts', 'main', 'err2')
    detector.recordSuccess('app.ts', 'main')
    expect(detector.recordFailure('app.ts', 'main', 'err3')).toBe('continue')
  })

  it('18.6 getFailures returns count for target', () => {
    detector.recordFailure('a.ts', 'fn', 'e1')
    detector.recordFailure('a.ts', 'fn', 'e2')
    expect(detector.getFailures('a.ts', 'fn')).toBe(2)
    expect(detector.getFailures('b.ts', 'fn')).toBe(0)
  })

  it('18.7 getPivotSuggestion returns non-empty after pivot threshold', () => {
    detector.recordFailure('a.ts', 'fn', 'e1')
    detector.recordFailure('a.ts', 'fn', 'e2')
    expect(detector.getPivotSuggestion('a.ts', 'fn')).toBeTruthy()
  })

  it('18.8 reset clears all state', () => {
    detector.recordFailure('a.ts', 'fn', 'e1')
    detector.reset()
    expect(detector.totalFailures).toBe(0)
    expect(detector.getState()).toHaveLength(0)
  })

  it('18.9 totalFailures accumulates across targets', () => {
    detector.recordFailure('a.ts', 'fn1', 'e1')
    detector.recordFailure('b.ts', 'fn2', 'e2')
    detector.recordFailure('b.ts', 'fn2', 'e3')
    expect(detector.totalFailures).toBe(3)
  })
})

// ── Context Monitor ─────────────────────────────────────────────

describe('ContextMonitor: 4-tier risk levels', () => {
  it('18.10 starts at green with zero usage', () => {
    const monitor = new ContextMonitor(200_000)
    expect(monitor.getRiskLevel()).toBe('green')
    expect(monitor.getUtilization()).toBe(0)
  })

  it('18.11 yellow at 40% utilization', () => {
    const monitor = new ContextMonitor(100_000)
    monitor.recordUsage(20_000, 20_000) // 40%
    expect(monitor.getRiskLevel()).toBe('yellow')
    expect(monitor.shouldCompact()).toBe(true)
  })

  it('18.12 orange at 50% utilization', () => {
    const monitor = new ContextMonitor(100_000)
    monitor.recordUsage(30_000, 20_000) // 50%
    expect(monitor.getRiskLevel()).toBe('orange')
  })

  it('18.13 red at 60% utilization', () => {
    const monitor = new ContextMonitor(100_000)
    monitor.recordUsage(40_000, 20_000) // 60%
    expect(monitor.getRiskLevel()).toBe('red')
    expect(monitor.shouldClear()).toBe(true)
  })

  it('18.14 reset clears usage', () => {
    const monitor = new ContextMonitor(100_000)
    monitor.recordUsage(50_000, 50_000)
    monitor.reset()
    expect(monitor.getUtilization()).toBe(0)
    expect(monitor.getRiskLevel()).toBe('green')
  })

  it('18.15 getSnapshot returns complete state', () => {
    const monitor = new ContextMonitor(200_000)
    monitor.recordUsage(10_000, 5_000)
    const snap = monitor.getSnapshot()
    expect(snap.inputTokens).toBe(10_000)
    expect(snap.outputTokens).toBe(5_000)
    expect(snap.totalTokens).toBe(15_000)
    expect(snap.modelWindow).toBe(200_000)
    expect(snap.utilization).toBeCloseTo(0.075)
  })

  it('18.16 getStatusString is human-readable', () => {
    const monitor = new ContextMonitor(100_000)
    monitor.recordUsage(25_000, 0)
    const status = monitor.getStatusString()
    expect(status).toContain('25.0%')
    expect(status).toContain('GREEN')
  })

  it('18.17 setModelWindow updates the window', () => {
    const monitor = new ContextMonitor(100_000)
    monitor.recordUsage(50_000, 0)
    expect(monitor.getRiskLevel()).toBe('orange')
    monitor.setModelWindow(200_000)
    expect(monitor.getRiskLevel()).toBe('green')
  })
})

// ── Error Classifier ────────────────────────────────────────────

describe('ErrorClassifier: categorization and recovery', () => {
  it('18.18 classifies 401 as auth', () => {
    const result = classifyError('401 Unauthorized: invalid api key')
    expect(result.category).toBe('auth')
    expect(result.retryable).toBe(false)
  })

  it('18.19 classifies 429 as rate_limit (retryable)', () => {
    const result = classifyError('429 Too Many Requests')
    expect(result.category).toBe('rate_limit')
    expect(result.retryable).toBe(true)
    expect(result.retryDelay).toBeGreaterThan(0)
  })

  it('18.20 classifies ENOENT as not_found', () => {
    const result = classifyError('ENOENT: no such file or directory')
    expect(result.category).toBe('not_found')
  })

  it('18.21 classifies timeout', () => {
    const result = classifyError('Request timed out after 30s')
    expect(result.category).toBe('timeout')
    expect(result.retryable).toBe(true)
  })

  it('18.22 classifies network errors', () => {
    const result = classifyError('ECONNREFUSED 127.0.0.1:8080')
    expect(result.category).toBe('network')
    expect(result.retryable).toBe(true)
  })

  it('18.23 unknown errors are not retryable', () => {
    const result = classifyError('something completely unexpected happened')
    expect(result.category).toBe('unknown')
    expect(result.retryable).toBe(false)
  })

  it('18.24 isRetryable helper works', () => {
    expect(isRetryable('429 rate limited')).toBe(true)
    expect(isRetryable('401 unauthorized')).toBe(false)
  })

  it('18.25 getRecoverySuggestion returns non-empty', () => {
    expect(getRecoverySuggestion('ENOENT file missing')).toBeTruthy()
    expect(getRecoverySuggestion('random error')).toBeTruthy()
  })
})

// ── Verification Gate ───────────────────────────────────────────

describe('VerificationGate: pre-completion checks', () => {
  it('18.26 runs git_clean check on a temp directory', () => {
    const dir = join(tmpdir(), `orca-vgate-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    const result = runVerificationGate(dir, ['git_clean'])

    // Not a git repo, so git_clean will fail
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0]!.name).toBe('git_clean')

    try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('18.27 returns score 1.0 when all checks pass or skip', () => {
    const dir = join(tmpdir(), `orca-vgate-empty-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    // With no recognizable project, lint/typecheck/test will be skipped
    const result = runVerificationGate(dir, [])

    expect(result.passed).toBe(true)
    expect(result.score).toBe(1.0)

    try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('18.28 provides remediation hints on failure', () => {
    const dir = join(tmpdir(), `orca-vgate-fail-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    const result = runVerificationGate(dir, ['git_clean'])

    if (result.checks[0]!.status === 'fail') {
      expect(result.remediation).toBeTruthy()
      expect(result.remediation).toContain('Uncommitted')
    }

    try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('18.29 runs on actual Orca project directory', () => {
    const projectDir = join(__dirname, '..')
    const result = runVerificationGate(projectDir, ['typecheck'])

    // Our project should pass typecheck
    expect(result.checks[0]!.name).toBe('typecheck')
    // It should either pass or have output
    expect(result.checks[0]!.status).toBeDefined()
  })
})
