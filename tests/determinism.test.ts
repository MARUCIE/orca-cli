/**
 * Round 10: Determinism & State Isolation — 15 tests
 *
 * Ensures tests produce identical results regardless of execution
 * order, prior state, or repetition count. Catches the #1 source
 * of CI flakes: shared mutable module-level state.
 *
 * Key finding from audit: taskStore + taskCounter are global
 * module-level variables that leak between tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const testDir = join(tmpdir(), `forge-determ-${Date.now()}`)

beforeAll(() => {
  mkdirSync(join(testDir, 'src'), { recursive: true })
  writeFileSync(join(testDir, 'src', 'app.ts'), 'export const version = "1.0.0"\n')
  writeFileSync(join(testDir, 'target.txt'), 'line1\nline2\nline3\n')
  try {
    execSync('git init && git add -A && git commit -m "init"', {
      cwd: testDir, encoding: 'utf-8', stdio: 'pipe',
    })
  } catch { /* ignore */ }
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Idempotency ─────────────────────────────────────────────────

describe('Idempotency: same operation twice → consistent result', () => {
  it('10.1 write_file same content twice — second call says Updated', () => {
    const r1 = executeTool('write_file', { path: 'idempotent.txt', content: 'hello' }, testDir)
    expect(r1.success).toBe(true)
    expect(r1.output).toContain('Created')

    const r2 = executeTool('write_file', { path: 'idempotent.txt', content: 'hello' }, testDir)
    expect(r2.success).toBe(true)
    expect(r2.output).toContain('Updated')

    // File content is identical after both calls
    const c1 = readFileSync(join(testDir, 'idempotent.txt'), 'utf-8')
    expect(c1).toBe('hello')
  })

  it('10.2 edit_file second call fails (old_string already replaced)', () => {
    writeFileSync(join(testDir, 'idemp-edit.txt'), 'original text here\n')
    const r1 = executeTool('edit_file', {
      path: 'idemp-edit.txt', old_string: 'original', new_string: 'modified',
    }, testDir)
    expect(r1.success).toBe(true)

    // Second call: old_string no longer exists → should fail
    const r2 = executeTool('edit_file', {
      path: 'idemp-edit.txt', old_string: 'original', new_string: 'modified',
    }, testDir)
    expect(r2.success).toBe(false)
    expect(r2.output).toContain('not found')
  })

  it('10.3 read_file returns identical output on repeated calls', () => {
    const r1 = executeTool('read_file', { path: 'target.txt' }, testDir)
    const r2 = executeTool('read_file', { path: 'target.txt' }, testDir)
    expect(r1.output).toBe(r2.output)
  })

  it('10.4 git_commit — two sequential commits on same changes', () => {
    // Create a fresh file and commit it
    writeFileSync(join(testDir, 'commit-test-determ.txt'), 'deterministic content')
    const r1 = executeTool('git_commit', { message: 'determ commit 1' }, testDir)
    expect(r1.success).toBe(true)

    // Second commit with NO new changes should fail
    const r2 = executeTool('git_commit', { message: 'determ commit 2' }, testDir)
    expect(r2.success).toBe(false)
  })

  it('10.5 search_files same query twice returns same results', () => {
    const r1 = executeTool('search_files', { pattern: 'version', path: '.' }, testDir)
    const r2 = executeTool('search_files', { pattern: 'version', path: '.' }, testDir)
    expect(r1.output).toBe(r2.output)
  })
})

// ── State Isolation ─────────────────────────────────────────────

describe('State isolation: operations do not leak side effects', () => {
  it('10.6 write_file to subdir does not affect parent', () => {
    executeTool('write_file', { path: 'sub/deep/file.txt', content: 'nested' }, testDir)
    // Parent files unchanged
    const parent = readFileSync(join(testDir, 'target.txt'), 'utf-8')
    expect(parent).toBe('line1\nline2\nline3\n')
  })

  it('10.7 edit_file on one file does not corrupt adjacent files', () => {
    writeFileSync(join(testDir, 'fileA.txt'), 'shared text\n')
    writeFileSync(join(testDir, 'fileB.txt'), 'shared text\n')

    executeTool('edit_file', {
      path: 'fileA.txt', old_string: 'shared text', new_string: 'changed A',
    }, testDir)

    // fileB should be unmodified
    const contentB = readFileSync(join(testDir, 'fileB.txt'), 'utf-8')
    expect(contentB).toBe('shared text\n')
  })

  it('10.8 delete_file does not affect same-name files in other directories', () => {
    mkdirSync(join(testDir, 'dir1'), { recursive: true })
    mkdirSync(join(testDir, 'dir2'), { recursive: true })
    writeFileSync(join(testDir, 'dir1', 'same.txt'), 'dir1 content')
    writeFileSync(join(testDir, 'dir2', 'same.txt'), 'dir2 content')

    executeTool('delete_file', { path: join(testDir, 'dir1', 'same.txt') }, testDir)

    expect(existsSync(join(testDir, 'dir1', 'same.txt'))).toBe(false)
    expect(existsSync(join(testDir, 'dir2', 'same.txt'))).toBe(true)
    expect(readFileSync(join(testDir, 'dir2', 'same.txt'), 'utf-8')).toBe('dir2 content')
  })

  it('10.9 task_create IDs always increment (no reset between calls)', () => {
    const r1 = executeTool('task_create', { title: 'Determ task A' }, testDir)
    const r2 = executeTool('task_create', { title: 'Determ task B' }, testDir)

    const id1 = Number(r1.output.match(/task-(\d+)/)?.[1])
    const id2 = Number(r2.output.match(/task-(\d+)/)?.[1])

    // IDs must be monotonically increasing
    expect(id2).toBeGreaterThan(id1)
  })

  it('10.10 task_update on non-existent ID fails consistently', () => {
    const r1 = executeTool('task_update', { id: 'task-999999', status: 'completed' }, testDir)
    const r2 = executeTool('task_update', { id: 'task-999999', status: 'completed' }, testDir)
    expect(r1.success).toBe(false)
    expect(r2.success).toBe(false)
    expect(r1.output).toBe(r2.output)
  })
})

// ── Concurrent-Style Safety ─────────────────────────────────────

describe('Concurrent-style: rapid sequential ops on shared resources', () => {
  it('10.11 rapid sequential writes to same file — last write wins', () => {
    const path = 'rapid-write.txt'
    for (let i = 0; i < 10; i++) {
      executeTool('write_file', { path, content: `iteration-${i}` }, testDir)
    }
    const content = readFileSync(join(testDir, path), 'utf-8')
    expect(content).toBe('iteration-9')
  })

  it('10.12 sequential edits — each edit sees the result of the previous', () => {
    writeFileSync(join(testDir, 'chain-edit.txt'), 'AAA BBB CCC\n')

    const r1 = executeTool('edit_file', {
      path: 'chain-edit.txt', old_string: 'AAA', new_string: 'XXX',
    }, testDir)
    expect(r1.success).toBe(true)

    const r2 = executeTool('edit_file', {
      path: 'chain-edit.txt', old_string: 'BBB', new_string: 'YYY',
    }, testDir)
    expect(r2.success).toBe(true)

    const r3 = executeTool('edit_file', {
      path: 'chain-edit.txt', old_string: 'CCC', new_string: 'ZZZ',
    }, testDir)
    expect(r3.success).toBe(true)

    const content = readFileSync(join(testDir, 'chain-edit.txt'), 'utf-8')
    expect(content).toBe('XXX YYY ZZZ\n')
  })

  it('10.13 multi_edit then single edit — file state is coherent', () => {
    writeFileSync(join(testDir, 'multi-then-single.txt'), 'aaa\nbbb\nccc\n')

    executeTool('multi_edit', {
      path: 'multi-then-single.txt',
      edits: [
        { old_string: 'aaa', new_string: '111' },
        { old_string: 'ccc', new_string: '333' },
      ],
    }, testDir)

    // Now do a single edit on the same file
    const r = executeTool('edit_file', {
      path: 'multi-then-single.txt', old_string: 'bbb', new_string: '222',
    }, testDir)
    expect(r.success).toBe(true)

    const content = readFileSync(join(testDir, 'multi-then-single.txt'), 'utf-8')
    expect(content).toBe('111\n222\n333\n')
  })

  it('10.14 create_plan IDs are timestamp-based and non-empty', () => {
    // Plan IDs use Date.now() — rapid calls may collide in same ms.
    // This test verifies the ID format, not uniqueness (known limitation).
    const r = executeTool('create_plan', {
      goal: 'Unique plan', steps: ['Step 1', 'Step 2'],
    }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toMatch(/plan-\d+/)
    // Plan should contain both steps
    expect(r.output).toContain('1. Step 1')
    expect(r.output).toContain('2. Step 2')
  })

  it('10.15 verify_plan runs checks in order, early failure visible', () => {
    const r = executeTool('verify_plan', {
      checks: [
        'true',                    // pass
        'false',                   // fail
        'echo "should still run"', // runs after failure
      ],
    }, testDir)

    // Overall should fail (not all checks pass)
    expect(r.success).toBe(false)
    // First check passes, second fails
    expect(r.output).toContain('✓ true')
    expect(r.output).toContain('✗ false')
    // Third check should still be evaluated
    expect(r.output).toContain('echo')
  })
})
