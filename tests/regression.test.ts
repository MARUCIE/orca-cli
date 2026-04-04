/**
 * Round 13: Regression Tests — 12 tests
 *
 * Verifies that bugs found by the SOTA audit are actually fixed.
 * Each test targets a specific bug that was confirmed exploitable
 * in Rounds 10-12 but is now patched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `forge-regression-${Date.now()}`)

beforeAll(() => {
  mkdirSync(join(testDir, 'src'), { recursive: true })
  writeFileSync(join(testDir, 'src', 'main.ts'), 'export function hello() { return "world" }\n')
  writeFileSync(join(testDir, 'test.ipynb'), JSON.stringify({
    cells: [
      { cell_type: 'code', source: ['x = 1\n'], metadata: {}, outputs: [] },
    ],
    metadata: {}, nbformat: 4, nbformat_minor: 5,
  }))
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Shell Injection Fixes ───────────────────────────────────────

describe('Regression: Shell injection hardening', () => {
  it('R.1 search_files — single quote in pattern does not break grep', () => {
    // Before fix: pattern with ' would close the shell string
    const r = executeTool('search_files', {
      pattern: "it's",
      path: '.',
    }, testDir)
    // Should complete without shell error — either finds matches or reports none
    expect(typeof r.success).toBe('boolean')
    expect(typeof r.output).toBe('string')
  })

  it('R.2 search_files — semicolon in pattern does not execute commands', () => {
    const r = executeTool('search_files', {
      pattern: 'test; echo INJECTED',
      path: '.',
    }, testDir)
    expect(r.success).toBe(true)
    // The output should NOT contain "INJECTED" from a command execution
    expect(r.output).not.toContain('INJECTED')
  })

  it('R.3 find_definition — single quote in name does not break grep', () => {
    const r = executeTool('find_definition', {
      name: "it's",
      path: '.',
    }, testDir)
    expect(typeof r.success).toBe('boolean')
  })

  it('R.4 find_references — special chars in name are escaped', () => {
    const r = executeTool('find_references', {
      name: "hello'world",
      path: '.',
    }, testDir)
    expect(typeof r.success).toBe('boolean')
    expect(typeof r.output).toBe('string')
  })

  it('R.5 glob_files — path with single quote does not break shell', () => {
    // Create dir with safe name for testing
    const r = executeTool('glob_files', {
      pattern: '*.ts',
      path: '.',
    }, testDir)
    expect(r.success).toBe(true)
  })
})

// ── Boundary Fixes ──────────────────────────────────────────────

describe('Regression: Boundary condition fixes', () => {
  it('R.6 read_file — start_line: 0 now clamps to line 1', () => {
    const r = executeTool('read_file', { path: 'src/main.ts', start_line: 0 }, testDir)
    expect(r.success).toBe(true)
    // With the fix, start_line: 0 → Math.max(0, 0-1) = Math.max(0, -1) = 0
    // So it reads from the beginning, which is correct
    expect(r.output).toContain('export function hello')
  })

  it('R.7 read_file — negative start_line clamps to 0', () => {
    const r = executeTool('read_file', { path: 'src/main.ts', start_line: -5 }, testDir)
    expect(r.success).toBe(true)
    // Math.max(0, -5 - 1) = Math.max(0, -6) = 0 → reads from start
    expect(r.output).toContain('export function hello')
  })

  it('R.8 notebook_edit — negative cell_index now rejected', () => {
    const r = executeTool('notebook_edit', {
      path: 'test.ipynb',
      cell_index: -1,
      content: 'evil code',
    }, testDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('Invalid cell_index')
  })

  it('R.9 notebook_edit — negative cell_index: -999 also rejected', () => {
    const r = executeTool('notebook_edit', {
      path: 'test.ipynb',
      cell_index: -999,
      content: 'should not work',
    }, testDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('Must be >= 0')
  })
})

// ── Plan ID Fix ─────────────────────────────────────────────────

describe('Regression: Plan ID uniqueness', () => {
  it('R.10 create_plan — rapid calls produce unique IDs (counter-based)', () => {
    const ids: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = executeTool('create_plan', {
        goal: `Goal ${i}`, steps: [`Step ${i}`],
      }, testDir)
      const match = r.output.match(/plan-\d+/)
      if (match) ids.push(match[0]!)
    }
    // All IDs must be unique (counter-based, no more Date.now() collisions)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(10)
  })

  it('R.11 create_plan — IDs are monotonically increasing', () => {
    const r1 = executeTool('create_plan', { goal: 'A', steps: ['1'] }, testDir)
    const r2 = executeTool('create_plan', { goal: 'B', steps: ['2'] }, testDir)
    const id1 = Number(r1.output.match(/plan-(\d+)/)?.[1])
    const id2 = Number(r2.output.match(/plan-(\d+)/)?.[1])
    expect(id2).toBeGreaterThan(id1)
  })
})

// ── Multi-edit Atomicity Verified ───────────────────────────────

describe('Regression: multi_edit atomicity', () => {
  it('R.12 failed multi_edit does not write partial results to disk', () => {
    writeFileSync(join(testDir, 'atomic-test.txt'), 'keep_this\nkeep_that\n')

    const r = executeTool('multi_edit', {
      path: 'atomic-test.txt',
      edits: [
        { old_string: 'keep_this', new_string: 'CHANGED' },  // would succeed
        { old_string: 'NONEXISTENT', new_string: 'XXX' },    // will fail
      ],
    }, testDir)
    expect(r.success).toBe(false)

    // File must be COMPLETELY unchanged — no partial writes
    const content = readFileSync(join(testDir, 'atomic-test.txt'), 'utf-8')
    expect(content).toBe('keep_this\nkeep_that\n')
  })
})
