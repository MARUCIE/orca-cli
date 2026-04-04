/**
 * Round 3: Edge cases — boundary conditions, error recovery, concurrent operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TOOL_DEFINITIONS, executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `forge-edge-${Date.now()}`)

beforeAll(() => {
  mkdirSync(join(testDir, 'src'), { recursive: true })
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Empty/Missing Input ──────────────────────────────────────────

describe('Edge: Empty inputs', () => {
  it('read_file — empty path', () => {
    const r = executeTool('read_file', { path: '' }, testDir)
    // Should handle gracefully (reads cwd or error)
    expect(typeof r.success).toBe('boolean')
  })

  it('write_file — empty content', () => {
    const r = executeTool('write_file', { path: 'empty.txt', content: '' }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'empty.txt'), 'utf-8')).toBe('')
  })

  it('edit_file — empty new_string (deletion)', () => {
    writeFileSync(join(testDir, 'del-line.ts'), 'line1\nDELETE_ME\nline3\n')
    const r = executeTool('edit_file', {
      path: 'del-line.ts',
      old_string: 'DELETE_ME\n',
      new_string: '',
    }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'del-line.ts'), 'utf-8')).toBe('line1\nline3\n')
  })

  it('search_files — empty pattern', () => {
    const r = executeTool('search_files', { pattern: '', path: '.' }, testDir)
    expect(typeof r.success).toBe('boolean')
  })

  it('run_command — empty command', () => {
    const r = executeTool('run_command', { command: '' }, testDir)
    expect(r.success).toBe(false)
  })

  it('glob_files — empty pattern', () => {
    const r = executeTool('glob_files', { pattern: '' }, testDir)
    expect(r.success).toBe(false)
  })

  it('task_update — nonexistent task', () => {
    const r = executeTool('task_update', { id: 'task-99999', status: 'completed' }, testDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('not found')
  })
})

// ── Large Files ──────────────────────────────────────────────────

describe('Edge: Large files', () => {
  it('read_file — file with 500 lines truncates at 300', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}: ${'x'.repeat(50)}`)
    writeFileSync(join(testDir, 'large.txt'), lines.join('\n'))
    const r = executeTool('read_file', { path: 'large.txt' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('truncated')
    expect(r.output).toContain('500 total lines')
  })

  it('read_file — line range on large file', () => {
    const r = executeTool('read_file', { path: 'large.txt', start_line: 450, end_line: 460 }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('line 450')
    expect(r.output).not.toContain('line 1:')
  })

  it('write_file — large content', () => {
    const content = 'x'.repeat(100_000)
    const r = executeTool('write_file', { path: 'big.bin', content }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'big.bin'), 'utf-8').length).toBe(100_000)
  })
})

// ── Special Characters ───────────────────────────────────────────

describe('Edge: Special characters', () => {
  it('write_file — unicode content', () => {
    const content = '你好世界 🌍\nこんにちは\n한국어\n'
    const r = executeTool('write_file', { path: 'unicode.txt', content }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'unicode.txt'), 'utf-8')).toBe(content)
  })

  it('edit_file — unicode replacement', () => {
    const r = executeTool('edit_file', {
      path: 'unicode.txt',
      old_string: '你好世界',
      new_string: 'Hello World',
    }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'unicode.txt'), 'utf-8')).toContain('Hello World')
  })

  it('write_file — file with spaces in name', () => {
    const r = executeTool('write_file', { path: 'my file.txt', content: 'space name' }, testDir)
    expect(r.success).toBe(true)
  })

  it('edit_file — content with regex special chars', () => {
    writeFileSync(join(testDir, 'regex.ts'), 'const re = /^test\\.\\d+$/\n')
    const r = executeTool('edit_file', {
      path: 'regex.ts',
      old_string: 'const re = /^test\\.\\d+$/',
      new_string: 'const re = /^prod\\.\\w+$/',
    }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'regex.ts'), 'utf-8')).toContain('prod')
  })

  it('edit_file — content with backticks and template literals', () => {
    writeFileSync(join(testDir, 'template.ts'), 'const msg = `hello ${name}`\n')
    const r = executeTool('edit_file', {
      path: 'template.ts',
      old_string: 'const msg = `hello ${name}`',
      new_string: 'const msg = `hi ${name}!`',
    }, testDir)
    expect(r.success).toBe(true)
  })
})

// ── Path Traversal Safety ────────────────────────────────────────

describe('Edge: Path handling', () => {
  it('read_file — absolute path works', () => {
    writeFileSync(join(testDir, 'abs.txt'), 'absolute')
    const r = executeTool('read_file', { path: join(testDir, 'abs.txt') }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('absolute')
  })

  it('list_directory — deeply nested empty dir', () => {
    mkdirSync(join(testDir, 'a', 'b', 'c', 'd'), { recursive: true })
    const r = executeTool('list_directory', { path: 'a', recursive: true }, testDir)
    expect(r.success).toBe(true)
  })

  it('create_directory — already exists is ok', () => {
    mkdirSync(join(testDir, 'already'), { recursive: true })
    const r = executeTool('create_directory', { path: join(testDir, 'already') }, testDir)
    expect(r.success).toBe(true)
  })
})

// ── Concurrent-Style Operations ──────────────────────────────────

describe('Edge: Sequential multi-edit', () => {
  it('multiple edits to same file in sequence', () => {
    writeFileSync(join(testDir, 'multi.ts'), `
const a = 1
const b = 2
const c = 3
const d = 4
`)
    executeTool('edit_file', { path: 'multi.ts', old_string: 'const a = 1', new_string: 'const a = 10' }, testDir)
    executeTool('edit_file', { path: 'multi.ts', old_string: 'const b = 2', new_string: 'const b = 20' }, testDir)
    executeTool('edit_file', { path: 'multi.ts', old_string: 'const c = 3', new_string: 'const c = 30' }, testDir)
    executeTool('edit_file', { path: 'multi.ts', old_string: 'const d = 4', new_string: 'const d = 40' }, testDir)

    const content = readFileSync(join(testDir, 'multi.ts'), 'utf-8')
    expect(content).toContain('const a = 10')
    expect(content).toContain('const b = 20')
    expect(content).toContain('const c = 30')
    expect(content).toContain('const d = 40')
  })

  it('edit then read shows updated content', () => {
    writeFileSync(join(testDir, 'chain.ts'), 'original content\n')
    executeTool('edit_file', { path: 'chain.ts', old_string: 'original', new_string: 'modified' }, testDir)
    const read = executeTool('read_file', { path: 'chain.ts' }, testDir)
    expect(read.output).toContain('modified content')
    expect(read.output).not.toContain('original')
  })
})

// ── Tool Search Coverage ─────────────────────────────────────────

describe('Edge: Tool search', () => {
  it('finds tools for common tasks', () => {
    const scenarios = [
      { query: 'write', expect: 'write_file' },
      { query: 'search', expect: 'search_files' },
      { query: 'agent', expect: 'spawn_agent' },
      { query: 'plan', expect: 'create_plan' },
      { query: 'notebook', expect: 'notebook_edit' },
      { query: 'port', expect: 'check_port' },
    ]
    for (const s of scenarios) {
      const r = executeTool('tool_search', { query: s.query }, testDir)
      expect(r.success).toBe(true)
      expect(r.output).toContain(s.expect)
    }
  })

  it('no results for nonsense query', () => {
    const r = executeTool('tool_search', { query: 'xyzzy12345' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('No tools')
  })
})

// ── Multi-edit Tool ──────────────────────────────────────────────

describe('Edge: Multi-edit', () => {
  it('applies multiple edits in order', () => {
    writeFileSync(join(testDir, 'batch.ts'), 'const x = 1\nconst y = 2\nconst z = 3\n')
    const r = executeTool('multi_edit', {
      path: 'batch.ts',
      edits: [
        { old_string: 'const x = 1', new_string: 'const x = 100' },
        { old_string: 'const z = 3', new_string: 'const z = 300' },
      ],
    }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('Applied 2 edits')
    const content = readFileSync(join(testDir, 'batch.ts'), 'utf-8')
    expect(content).toContain('100')
    expect(content).toContain('300')
    expect(content).toContain('const y = 2') // unchanged
  })

  it('fails mid-batch and reports progress', () => {
    writeFileSync(join(testDir, 'fail-batch.ts'), 'aaa\nbbb\n')
    const r = executeTool('multi_edit', {
      path: 'fail-batch.ts',
      edits: [
        { old_string: 'aaa', new_string: 'AAA' },
        { old_string: 'NONEXISTENT', new_string: 'XXX' },
      ],
    }, testDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('Applied 1 edits before failure')
  })
})
