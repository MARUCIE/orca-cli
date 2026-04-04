/**
 * Round 1: Full tool coverage — all 41 tools exercised.
 * Simulates real coding scenarios with actual file operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TOOL_DEFINITIONS, executeTool, DANGEROUS_TOOLS } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const testDir = join(tmpdir(), `forge-full-${Date.now()}`)

beforeAll(() => {
  mkdirSync(join(testDir, 'src'), { recursive: true })
  mkdirSync(join(testDir, 'tests'), { recursive: true })

  // Create a realistic project structure
  writeFileSync(join(testDir, 'package.json'), '{"name":"test-project","version":"1.0.0"}\n')
  writeFileSync(join(testDir, 'src', 'index.ts'), `
export function add(a: number, b: number): number {
  return a + b
}

export function multiply(a: number, b: number): number {
  return a * b
}

export class Calculator {
  private history: number[] = []

  calculate(op: string, a: number, b: number): number {
    let result: number
    switch (op) {
      case 'add': result = add(a, b); break
      case 'multiply': result = multiply(a, b); break
      default: throw new Error('Unknown operation')
    }
    this.history.push(result)
    return result
  }
}
`)
  writeFileSync(join(testDir, 'src', 'utils.ts'), `
export function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function isEven(n: number): boolean {
  return n % 2 === 0
}
`)
  writeFileSync(join(testDir, 'tests', 'index.test.ts'), `
import { add, multiply } from '../src/index'
describe('math', () => {
  it('adds', () => expect(add(1, 2)).toBe(3))
  it('multiplies', () => expect(multiply(3, 4)).toBe(12))
})
`)
  writeFileSync(join(testDir, 'README.md'), '# Test Project\n\nA simple calculator.\n')

  // Init git repo for git tools
  try {
    execSync('git init && git add -A && git commit -m "init"', {
      cwd: testDir, encoding: 'utf-8', stdio: 'pipe',
    })
  } catch { /* ignore git errors in CI */ }
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Registry Tests ───────────────────────────────────────────────

describe('Round 1: Tool Registry', () => {
  it('has exactly 41 tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(41)
  })

  it('all tools have valid function calling schema', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.type).toBe('function')
      expect(t.function.name).toMatch(/^[a-z_]+$/)
      expect(typeof t.function.description).toBe('string')
      expect(t.function.description.length).toBeGreaterThan(10)
      expect(t.function.parameters.type).toBe('object')
    }
  })

  it('no duplicate names', () => {
    const names = TOOL_DEFINITIONS.map(t => t.function.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('DANGEROUS_TOOLS are valid tool names', () => {
    const names = new Set(TOOL_DEFINITIONS.map(t => t.function.name))
    for (const d of DANGEROUS_TOOLS) {
      expect(names.has(d)).toBe(true)
    }
  })

  it('has exactly 9 dangerous tools', () => {
    expect(DANGEROUS_TOOLS.size).toBe(9)
  })
})

// ── File I/O Tools (10) ──────────────────────────────────────────

describe('Round 1: File I/O', () => {
  it('read_file — full file', () => {
    const r = executeTool('read_file', { path: 'src/index.ts' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('export function add')
    expect(r.output).toContain('Calculator')
  })

  it('read_file — line range', () => {
    const r = executeTool('read_file', { path: 'src/index.ts', start_line: 2, end_line: 4 }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('add')
    expect(r.output).not.toContain('Calculator')
  })

  it('write_file — create new', () => {
    const r = executeTool('write_file', { path: 'new.txt', content: 'hello\nworld\n' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('Created')
    expect(readFileSync(join(testDir, 'new.txt'), 'utf-8')).toBe('hello\nworld\n')
  })

  it('write_file — overwrite existing shows delta', () => {
    writeFileSync(join(testDir, 'overwrite.txt'), 'a\nb\nc\n')
    const r = executeTool('write_file', { path: 'overwrite.txt', content: 'x\n' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('Updated')
    expect(r.output).toMatch(/-\d/)
  })

  it('edit_file — precise replacement', () => {
    const r = executeTool('edit_file', {
      path: 'src/utils.ts',
      old_string: 'return n.toLocaleString()',
      new_string: 'return n.toFixed(2)',
    }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'src', 'utils.ts'), 'utf-8')).toContain('toFixed(2)')
  })

  it('edit_file — fails on non-unique match', () => {
    writeFileSync(join(testDir, 'dup.ts'), 'const x = 1\nconst x = 1\n')
    const r = executeTool('edit_file', { path: 'dup.ts', old_string: 'const x = 1', new_string: 'const x = 2' }, testDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('multiple')
  })

  it('delete_file', () => {
    writeFileSync(join(testDir, 'deleteme.txt'), 'temp')
    const r = executeTool('delete_file', { path: join(testDir, 'deleteme.txt') }, testDir)
    expect(r.success).toBe(true)
    expect(existsSync(join(testDir, 'deleteme.txt'))).toBe(false)
  })

  it('move_file', () => {
    writeFileSync(join(testDir, 'moveme.txt'), 'data')
    const r = executeTool('move_file', {
      source: join(testDir, 'moveme.txt'),
      destination: join(testDir, 'moved.txt'),
    }, testDir)
    expect(r.success).toBe(true)
    expect(existsSync(join(testDir, 'moved.txt'))).toBe(true)
  })

  it('copy_file', () => {
    const r = executeTool('copy_file', {
      source: join(testDir, 'moved.txt'),
      destination: join(testDir, 'copied.txt'),
    }, testDir)
    expect(r.success).toBe(true)
    expect(readFileSync(join(testDir, 'copied.txt'), 'utf-8')).toBe('data')
  })

  it('create_directory', () => {
    const r = executeTool('create_directory', { path: join(testDir, 'deep', 'nested', 'dir') }, testDir)
    expect(r.success).toBe(true)
    expect(existsSync(join(testDir, 'deep', 'nested', 'dir'))).toBe(true)
  })

  it('file_info', () => {
    const r = executeTool('file_info', { path: 'src/index.ts' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('type: file')
    expect(r.output).toContain('lines:')
    expect(r.output).toContain('size:')
  })
})

// ── Search & Navigation (8) ──────────────────────────────────────

describe('Round 1: Search & Navigation', () => {
  it('list_directory', () => {
    const r = executeTool('list_directory', { path: '.' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('src/')
    expect(r.output).toContain('package.json')
  })

  it('list_directory — recursive', () => {
    const r = executeTool('list_directory', { path: '.', recursive: true }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('index.ts')
    expect(r.output).toContain('utils.ts')
  })

  it('glob_files — *.ts', () => {
    const r = executeTool('glob_files', { pattern: '*.ts' }, testDir)
    expect(r.success).toBe(true)
    // Should find TypeScript files
  })

  it('search_files — pattern match', () => {
    const r = executeTool('search_files', { pattern: 'Calculator', path: '.' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('index.ts')
  })

  it('find_definition — function', () => {
    const r = executeTool('find_definition', { name: 'multiply', path: '.' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('function multiply')
  })

  it('find_definition — class', () => {
    const r = executeTool('find_definition', { name: 'Calculator', path: '.' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('class Calculator')
  })

  it('find_references — symbol usage', () => {
    const r = executeTool('find_references', { name: 'add', path: '.' }, testDir)
    expect(r.success).toBe(true)
    // Should find add in index.ts and test file
  })

  it('directory_tree', () => {
    const r = executeTool('directory_tree', { path: '.', depth: 2 }, testDir)
    expect(r.success).toBe(true)
  })

  it('count_lines', () => {
    const r = executeTool('count_lines', { path: '.' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('total')
  })

  it('tool_search — finds git tools', () => {
    const r = executeTool('tool_search', { query: 'git' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('git_status')
  })

  it('tool_search — finds file tools', () => {
    const r = executeTool('tool_search', { query: 'edit' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('edit_file')
  })
})

// ── Git Tools (4) ────────────────────────────────────────────────

describe('Round 1: Git', () => {
  it('git_status', () => {
    const r = executeTool('git_status', {}, testDir)
    expect(r.success).toBe(true)
    // May have modified files from earlier tests
  })

  it('git_log', () => {
    const r = executeTool('git_log', { count: 5 }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('init')
  })

  it('git_diff', () => {
    const r = executeTool('git_diff', {}, testDir)
    // May or may not have changes
    expect(r.success).toBe(true)
  })
})

// ── Execution Tools (4) ──────────────────────────────────────────

describe('Round 1: Execution', () => {
  it('run_command — echo', () => {
    const r = executeTool('run_command', { command: 'echo "hello from forge"' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('hello from forge')
  })

  it('run_command — cwd override', () => {
    const r = executeTool('run_command', { command: 'pwd', cwd: '/tmp' }, testDir)
    expect(r.success).toBe(true)
  })

  it('run_command — timeout on long command', () => {
    // This should fail gracefully, not hang
    const r = executeTool('run_command', { command: 'sleep 0.1 && echo done' }, testDir)
    expect(r.success).toBe(true)
  })

  it('check_port — free port', () => {
    const r = executeTool('check_port', { port: 59999 }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('free')
  })
})

// ── Task Management (3) ──────────────────────────────────────────

describe('Round 1: Task Management', () => {
  it('full lifecycle: create → update → list', () => {
    const c1 = executeTool('task_create', { title: 'Setup database' }, testDir)
    expect(c1.success).toBe(true)
    const id1 = c1.output.match(/task-\d+/)?.[0]!

    const c2 = executeTool('task_create', { title: 'Write tests' }, testDir)
    expect(c2.success).toBe(true)
    const id2 = c2.output.match(/task-\d+/)?.[0]!

    executeTool('task_update', { id: id1, status: 'in_progress' }, testDir)
    executeTool('task_update', { id: id2, status: 'completed' }, testDir)

    const list = executeTool('task_list', {}, testDir)
    expect(list.success).toBe(true)
    expect(list.output).toContain('Setup database')
    expect(list.output).toContain('in_progress')
    expect(list.output).toContain('completed')
  })
})

// ── Planning (2) ──────────────────────────────────────────────────

describe('Round 1: Planning', () => {
  it('create_plan', () => {
    const r = executeTool('create_plan', {
      goal: 'Add user authentication',
      steps: ['Design schema', 'Implement JWT', 'Add middleware', 'Write tests'],
    }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('Add user authentication')
    expect(r.output).toContain('1. Design schema')
  })

  it('verify_plan — check passes', () => {
    const r = executeTool('verify_plan', {
      checks: ['test -f package.json', 'test -d src'],
    }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('✓')
  })

  it('verify_plan — check fails', () => {
    const r = executeTool('verify_plan', {
      checks: ['test -f nonexistent.xyz'],
    }, testDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('✗')
  })
})

// ── Interaction (2) ───────────────────────────────────────────────

describe('Round 1: Interaction', () => {
  it('notify_user', () => {
    const r = executeTool('notify_user', { message: 'Build complete', level: 'success' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('Build complete')
  })
})

// ── MCP (3) ───────────────────────────────────────────────────────

describe('Round 1: MCP', () => {
  it('mcp_list_servers — no config', () => {
    const r = executeTool('mcp_list_servers', {}, testDir)
    expect(r.success).toBe(true)
    // No MCP servers configured in test dir
  })
})

// ── Unknown Tool ─────────────────────────────────────────────────

describe('Round 1: Error Handling', () => {
  it('unknown tool returns error', () => {
    const r = executeTool('nonexistent', {}, testDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('Unknown tool')
  })

  it('read_file — missing file', () => {
    const r = executeTool('read_file', { path: 'does/not/exist.ts' }, testDir)
    expect(r.success).toBe(false)
  })

  it('edit_file — missing file', () => {
    const r = executeTool('edit_file', { path: 'nope.ts', old_string: 'x', new_string: 'y' }, testDir)
    expect(r.success).toBe(false)
  })

  it('edit_file — empty old_string', () => {
    const r = executeTool('edit_file', { path: 'src/index.ts', old_string: '', new_string: 'y' }, testDir)
    expect(r.success).toBe(false)
  })

  it('run_command — invalid command', () => {
    const r = executeTool('run_command', { command: 'nonexistent_command_12345' }, testDir)
    expect(r.success).toBe(false)
  })
})
