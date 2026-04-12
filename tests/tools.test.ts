import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TOOL_DEFINITIONS, executeTool, DANGEROUS_TOOLS } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `orca-test-${Date.now()}`)

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'hello.ts'), 'const greeting = "hello world"\nconsole.log(greeting)\n')
  writeFileSync(join(testDir, 'data.json'), '{"name": "test", "version": 1}\n')
  mkdirSync(join(testDir, 'src'), { recursive: true })
  writeFileSync(join(testDir, 'src', 'index.ts'), 'export function main() { return 42 }\n')
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('TOOL_DEFINITIONS', () => {
  it('has 41 tools registered', () => {
    expect(TOOL_DEFINITIONS.length).toBe(41)
  })

  it('every tool has name, description, and parameters', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.function.name).toBeTruthy()
      expect(t.function.description).toBeTruthy()
      expect(t.function.parameters).toBeTruthy()
    }
  })

  it('has no duplicate tool names', () => {
    const names = TOOL_DEFINITIONS.map(t => t.function.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('DANGEROUS_TOOLS is a subset of defined tools', () => {
    const names = new Set(TOOL_DEFINITIONS.map(t => t.function.name))
    for (const d of DANGEROUS_TOOLS) {
      expect(names.has(d)).toBe(true)
    }
  })
})

describe('read_file', () => {
  it('reads an existing file', () => {
    const result = executeTool('read_file', { path: 'hello.ts' }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello world')
  })

  it('reads with line range', () => {
    const result = executeTool('read_file', { path: 'hello.ts', start_line: 2, end_line: 2 }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('console.log')
    expect(result.output).not.toContain('greeting =')
  })

  it('fails for missing file', () => {
    const result = executeTool('read_file', { path: 'nonexistent.ts' }, testDir)
    expect(result.success).toBe(false)
    expect(result.output).toContain('not found')
  })
})

describe('edit_file', () => {
  it('replaces a unique string', () => {
    writeFileSync(join(testDir, 'edit-target.ts'), 'const x = 1\nconst y = 2\n')
    const result = executeTool('edit_file', {
      path: 'edit-target.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 42',
    }, testDir)
    expect(result.success).toBe(true)
    expect(readFileSync(join(testDir, 'edit-target.ts'), 'utf-8')).toContain('const x = 42')
  })

  it('fails when old_string not found', () => {
    const result = executeTool('edit_file', {
      path: 'hello.ts',
      old_string: 'this does not exist',
      new_string: 'replacement',
    }, testDir)
    expect(result.success).toBe(false)
    expect(result.output).toContain('not found')
  })

  it('fails when old_string matches multiple locations', () => {
    writeFileSync(join(testDir, 'dup.ts'), 'const a = 1\nconst a = 1\n')
    const result = executeTool('edit_file', {
      path: 'dup.ts',
      old_string: 'const a = 1',
      new_string: 'const a = 2',
    }, testDir)
    expect(result.success).toBe(false)
    expect(result.output).toContain('multiple locations')
  })
})

describe('glob_files', () => {
  it('finds TypeScript files', () => {
    const result = executeTool('glob_files', { pattern: '*.ts' }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello.ts')
  })

  it('returns no matches for missing pattern', () => {
    const result = executeTool('glob_files', { pattern: '*.xyz' }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('No files')
  })
})

describe('write_file', () => {
  it('creates a new file', () => {
    const result = executeTool('write_file', {
      path: 'new-file.txt',
      content: 'hello from test',
    }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('Created')
    expect(readFileSync(join(testDir, 'new-file.txt'), 'utf-8')).toBe('hello from test')
  })

  it('overwrites existing file with line delta', () => {
    writeFileSync(join(testDir, 'overwrite.txt'), 'line1\nline2\n')
    const result = executeTool('write_file', {
      path: 'overwrite.txt',
      content: 'single line\n',
    }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('Updated')
  })
})

describe('list_directory', () => {
  it('lists directory entries', () => {
    const result = executeTool('list_directory', { path: '.' }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello.ts')
    expect(result.output).toContain('src/')
  })
})

describe('search_files', () => {
  it('finds pattern in files', () => {
    const result = executeTool('search_files', { pattern: 'greeting', path: '.' }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello.ts')
  })
})

describe('file_info', () => {
  it('returns file metadata', () => {
    const result = executeTool('file_info', { path: 'hello.ts' }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('type: file')
    expect(result.output).toContain('lines:')
  })
})

describe('task management', () => {
  it('create → update → list lifecycle', () => {
    const create = executeTool('task_create', { title: 'Test task' }, testDir)
    expect(create.success).toBe(true)
    const taskId = create.output.match(/task-\d+/)?.[0]
    expect(taskId).toBeTruthy()

    const update = executeTool('task_update', { id: taskId, status: 'completed' }, testDir)
    expect(update.success).toBe(true)

    const list = executeTool('task_list', {}, testDir)
    expect(list.success).toBe(true)
    expect(list.output).toContain('Test task')
    expect(list.output).toContain('completed')
  })
})

describe('tool_search', () => {
  it('finds tools by keyword', () => {
    const result = executeTool('tool_search', { query: 'git' }, testDir)
    expect(result.success).toBe(true)
    expect(result.output).toContain('git_status')
    expect(result.output).toContain('git_diff')
  })
})

describe('unknown tool', () => {
  it('returns error for unknown tool', () => {
    const result = executeTool('nonexistent_tool', {}, testDir)
    expect(result.success).toBe(false)
    expect(result.output).toContain('Unknown tool')
  })
})
