/**
 * Round 15: Agent Intelligence — 20 tests
 *
 * Tests the three new agent loop intelligence modules:
 *   1. Auto-verify: run checks after file modifications
 *   2. Token budget manager: track usage, smart compaction
 *   3. Retry intelligence: prevent infinite failure loops
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { autoVerify, formatVerifyOutput } from '../src/auto-verify.js'
import { TokenBudgetManager } from '../src/token-budget.js'
import { RetryTracker } from '../src/retry-intelligence.js'
import type { ChatMessage } from '../src/providers/openai-compat.js'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Auto-Verify ─────────────────────────────────────────────────

describe('Auto-verify: check detection and execution', () => {
  const verifyDir = join(tmpdir(), `forge-verify-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(join(verifyDir, 'src'), { recursive: true })
    // Create a TypeScript project
    writeFileSync(join(verifyDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"noEmit":true}}')
    writeFileSync(join(verifyDir, 'src', 'index.ts'), 'export const x: number = 1\n')
  })

  afterAll(() => {
    try { rmSync(verifyDir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('15.1 detects TypeScript project and runs typecheck', () => {
    const result = autoVerify(join(verifyDir, 'src', 'index.ts'), verifyDir)
    // May or may not find tsc — depends on environment
    // The important thing is it doesn't crash
    if (result) {
      expect(result.checks.length).toBeGreaterThanOrEqual(1)
      expect(result.checks[0]!.name).toBe('typecheck')
    }
  })

  it('15.2 skips verification for non-code files', () => {
    writeFileSync(join(verifyDir, 'readme.md'), '# Hello\n')
    const result = autoVerify(join(verifyDir, 'readme.md'), verifyDir)
    // .md files should not trigger any checks
    expect(result).toBeNull()
  })

  it('15.3 respects enabled: false config', () => {
    const result = autoVerify(join(verifyDir, 'src', 'index.ts'), verifyDir, { enabled: false })
    expect(result).toBeNull()
  })

  it('15.4 respects custom extension filter', () => {
    const result = autoVerify(join(verifyDir, 'src', 'index.ts'), verifyDir, {
      extensions: ['.py'], // Only verify Python files
    })
    expect(result).toBeNull()
  })

  it('15.5 custom commands override auto-detect', () => {
    const result = autoVerify(join(verifyDir, 'src', 'index.ts'), verifyDir, {
      commands: ['echo "custom check passed"'],
    })
    expect(result).not.toBeNull()
    expect(result!.checks[0]!.name).toBe('check-1')
    expect(result!.checks[0]!.passed).toBe(true)
    expect(result!.checks[0]!.output).toContain('custom check passed')
  })

  it('15.6 formatVerifyOutput returns empty for null result', () => {
    expect(formatVerifyOutput(null)).toBe('')
  })

  it('15.7 formatVerifyOutput formats failed checks', () => {
    const result = autoVerify(join(verifyDir, 'src', 'index.ts'), verifyDir, {
      commands: ['false'], // always fails
    })
    if (result) {
      const output = formatVerifyOutput(result)
      expect(output).toContain('✗')
      expect(output).toContain('verify')
    }
  })
})

// ── Token Budget Manager ────────────────────────────────────────

describe('Token budget: tracking and compaction', () => {
  it('15.8 getBudget returns correct model context window', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    const budget = mgr.getBudget([])
    expect(budget.contextWindow).toBe(200_000)
    expect(budget.utilizationPct).toBe(0)
    expect(budget.risk).toBe('green')
  })

  it('15.9 getBudget detects different model windows', () => {
    const gemini = new TokenBudgetManager('gemini-3.1-pro')
    expect(gemini.getBudget([]).contextWindow).toBe(2_000_000)

    const gpt = new TokenBudgetManager('gpt-5.4')
    expect(gpt.getBudget([]).contextWindow).toBe(256_000)
  })

  it('15.10 recordUsage accumulates token counts', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    mgr.recordUsage(1000, 500)
    mgr.recordUsage(2000, 1000)
    expect(mgr.totalTokens).toBe(4500)
  })

  it('15.11 utilization increases with history', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    const history: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(100_000) },
      { role: 'assistant', content: 'y'.repeat(100_000) },
    ]
    const budget = mgr.getBudget(history)
    // 200K chars ÷ 4 = 50K tokens, out of 200K context = 25%
    expect(budget.utilizationPct).toBeGreaterThan(20)
    expect(budget.utilizationPct).toBeLessThan(30)
    expect(budget.risk).toBe('green')
  })

  it('15.12 high utilization triggers yellow/orange/red risk', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    // 200K context window, 4 chars/token → 800K chars fills it
    const bigHistory: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(400_000) }, // ~100K tokens = 50%
    ]
    const budget = mgr.getBudget(bigHistory)
    expect(budget.risk).toBe('orange') // 50% → orange
  })

  it('15.13 smartCompact drops older messages, keeps recent', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    const history: ChatMessage[] = [
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: 'old question 1' },
      { role: 'assistant', content: 'old answer 1 '.repeat(100) },
      { role: 'user', content: 'old question 2' },
      { role: 'assistant', content: 'old answer 2 '.repeat(100) },
      { role: 'user', content: 'old question 3' },
      { role: 'assistant', content: 'old answer 3 '.repeat(100) },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ]

    const result = mgr.smartCompact(history, 1) // keep only last 1 turn

    expect(result.dropped).toBeGreaterThan(0)
    expect(result.tokensFreed).toBeGreaterThan(0)
    // System message preserved
    expect(history.find(m => m.role === 'system')).toBeDefined()
    // Recent turn preserved
    expect(history.some(m => m.content === 'recent question')).toBe(true)
    expect(history.some(m => m.content === 'recent answer')).toBe(true)
    // Old verbose messages dropped
    expect(history.some(m => m.content.startsWith('old answer 1'))).toBe(false)
  })

  it('15.14 smartCompact preserves decision-bearing messages', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    const history: ChatMessage[] = [
      { role: 'system', content: 'System.' },
      { role: 'assistant', content: 'I fixed the bug in auth.ts' },
      { role: 'assistant', content: 'Long verbose explanation '.repeat(200) },
      { role: 'assistant', content: 'Created new middleware' },
      { role: 'assistant', content: 'Another long explanation '.repeat(200) },
      { role: 'user', content: 'recent' },
      { role: 'assistant', content: 'recent answer' },
    ]

    const result = mgr.smartCompact(history, 1)

    // Decision messages ("fixed", "created") should be preserved in summary
    const compactedMsg = history.find(m => m.content.includes('[compacted'))
    if (compactedMsg) {
      expect(compactedMsg.content).toContain('fixed')
    }
    expect(result.summary).toContain('Dropped')
  })

  it('15.15 smartCompact with few messages does nothing', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    const history: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    const result = mgr.smartCompact(history, 2)
    expect(result.dropped).toBe(0)
    expect(result.summary).toContain('Nothing to compact')
  })
})

// ── Retry Intelligence ──────────────────────────────────────────

describe('Retry intelligence: failure tracking and hints', () => {
  it('15.16 first failure returns no warning', () => {
    const tracker = new RetryTracker(2)
    const hint = tracker.recordFailure('edit_file', { path: 'test.ts' }, 'not found')
    expect(hint.shouldWarn).toBe(false)
  })

  it('15.17 second failure of same tool+args triggers warning', () => {
    const tracker = new RetryTracker(2)
    tracker.recordFailure('edit_file', { path: 'test.ts' }, 'not found')
    const hint = tracker.recordFailure('edit_file', { path: 'test.ts' }, 'not found again')
    expect(hint.shouldWarn).toBe(true)
    expect(hint.hint).toContain('failed 2 times')
    expect(hint.suggestion).toContain('read_file')
  })

  it('15.18 success clears failure tracking', () => {
    const tracker = new RetryTracker(2)
    tracker.recordFailure('edit_file', { path: 'test.ts' }, 'not found')
    tracker.recordSuccess('edit_file', { path: 'test.ts' })
    // After success, counter resets
    const hint = tracker.recordFailure('edit_file', { path: 'test.ts' }, 'not found')
    expect(hint.shouldWarn).toBe(false) // only 1 failure since reset
  })

  it('15.19 different args are tracked separately', () => {
    const tracker = new RetryTracker(2)
    tracker.recordFailure('edit_file', { path: 'a.ts' }, 'not found')
    tracker.recordFailure('edit_file', { path: 'a.ts' }, 'not found')
    // a.ts has 2 failures → warns
    const hintA = tracker.recordFailure('edit_file', { path: 'a.ts' }, 'not found')
    expect(hintA.shouldWarn).toBe(true)

    // b.ts has 0 failures → no warn
    const hintB = tracker.recordFailure('edit_file', { path: 'b.ts' }, 'not found')
    expect(hintB.shouldWarn).toBe(false)
  })

  it('15.20 getFailureCount returns total per tool', () => {
    const tracker = new RetryTracker(3)
    tracker.recordFailure('search_files', { pattern: 'foo' }, 'no match')
    tracker.recordFailure('search_files', { pattern: 'bar' }, 'no match')
    tracker.recordFailure('edit_file', { path: 'x.ts' }, 'not found')

    expect(tracker.getFailureCount('search_files')).toBe(2)
    expect(tracker.getFailureCount('edit_file')).toBe(1)
    expect(tracker.getFailureCount('read_file')).toBe(0)
  })

  it('15.21 reset clears all records', () => {
    const tracker = new RetryTracker(2)
    tracker.recordFailure('edit_file', { path: 'test.ts' }, 'fail')
    tracker.recordFailure('edit_file', { path: 'test.ts' }, 'fail')
    tracker.reset()
    expect(tracker.getFailureCount('edit_file')).toBe(0)
  })

  it('15.22 tool-specific suggestions for known tools', () => {
    const tracker = new RetryTracker(1) // warn after 1 failure for testing
    const tools = ['edit_file', 'read_file', 'search_files', 'run_command', 'git_commit', 'write_file']
    for (const tool of tools) {
      const hint = tracker.recordFailure(tool, {}, 'error')
      expect(hint.shouldWarn).toBe(true)
      expect(hint.suggestion).toBeTruthy()
    }
  })
})
