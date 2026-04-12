/**
 * Round 14: SOTA Capabilities — 15 tests
 *
 * Tests the three new SOTA agent capabilities:
 *   1. Project context loader (auto-detect project type)
 *   2. Smart output truncation (prevent context pollution)
 *   3. Error self-correction hints (guide model to fix itself)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadProjectContext, formatContextForPrompt } from '../src/context.js'
import { buildSystemPrompt } from '../src/system-prompt.js'
import { executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

// ── Project Context Loader ──────────────────────────────────────

describe('Project context: Node/TypeScript detection', () => {
  const projDir = join(tmpdir(), `orca-ctx-node-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(join(projDir, 'src'), { recursive: true })
    writeFileSync(join(projDir, 'package.json'), JSON.stringify({
      name: 'my-app',
      dependencies: { express: '^4.18.0', react: '^18.0.0' },
      devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
      main: 'dist/index.js',
      bin: { 'my-app': './dist/cli.js' },
    }))
    writeFileSync(join(projDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}')
    writeFileSync(join(projDir, 'src', 'index.ts'), 'export const app = "hello"\n')
    writeFileSync(join(projDir, 'src', 'utils.py'), 'def helper(): pass\n')
    try {
      execSync('git init && git add -A && git commit -m "init"', {
        cwd: projDir, encoding: 'utf-8', stdio: 'pipe',
      })
    } catch { /* ignore */ }
  })

  afterAll(() => {
    try { rmSync(projDir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('14.1 detects node-typescript project type', () => {
    const ctx = loadProjectContext(projDir)
    expect(ctx.type).toBe('node-typescript')
  })

  it('14.2 reads project name from package.json', () => {
    const ctx = loadProjectContext(projDir)
    expect(ctx.name).toBe('my-app')
  })

  it('14.3 counts dependencies correctly', () => {
    const ctx = loadProjectContext(projDir)
    expect(ctx.deps).not.toBeNull()
    expect(ctx.deps!.production).toBe(2)
    expect(ctx.deps!.development).toBe(2)
  })

  it('14.4 detects framework from dependencies', () => {
    const ctx = loadProjectContext(projDir)
    // Has both express and react
    expect(ctx.framework).toContain('React')
  })

  it('14.5 detects test runner', () => {
    const ctx = loadProjectContext(projDir)
    expect(ctx.testRunner).toBe('Vitest')
  })

  it('14.6 detects multiple languages', () => {
    const ctx = loadProjectContext(projDir)
    expect(ctx.languages).toContain('TypeScript')
    expect(ctx.languages).toContain('Python')
  })

  it('14.7 detects entry points', () => {
    const ctx = loadProjectContext(projDir)
    expect(ctx.entryPoints).toContain('dist/index.js')
    expect(ctx.entryPoints).toContain('./dist/cli.js')
  })

  it('14.8 includes git info', () => {
    const ctx = loadProjectContext(projDir)
    expect(ctx.git).not.toBeNull()
    expect(ctx.git!.branch).toBeTruthy()
    expect(ctx.git!.recentCommits.length).toBeGreaterThan(0)
  })

  it('14.9 formatContextForPrompt produces readable summary', () => {
    const ctx = loadProjectContext(projDir)
    const formatted = formatContextForPrompt(ctx)
    expect(formatted).toContain('my-app')
    expect(formatted).toContain('node-typescript')
    expect(formatted).toContain('React')
    expect(formatted).toContain('Vitest')
    expect(formatted).toContain('2 prod')
  })

  it('14.10 buildSystemPrompt includes project context', () => {
    const prompt = buildSystemPrompt(projDir)
    expect(prompt).toContain('my-app')
    expect(prompt).toContain('node-typescript')
  })
})

// ── Smart Output Truncation ─────────────────────────────────────

describe('Smart output truncation', () => {
  const truncDir = join(tmpdir(), `orca-trunc-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(join(truncDir, 'src'), { recursive: true })
    // Create many files with searchable content
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(truncDir, 'src', `module${i}.ts`),
        Array.from({ length: 50 }, (_, j) => `// line ${j}: searchable_pattern in module${i}`).join('\n'))
    }
  })

  afterAll(() => {
    try { rmSync(truncDir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('14.11 large search output includes summary header', () => {
    const r = executeTool('search_files', {
      pattern: 'searchable_pattern',
      path: '.',
    }, truncDir)
    expect(r.success).toBe(true)
    // With 20 files × 50 lines = 1000 matches → should trigger truncation
    if (r.output.length > 8000) {
      expect(r.output).toContain('lines total')
      expect(r.output).toContain('files:')
    }
  })

  it('14.12 short output is not truncated', () => {
    const r = executeTool('search_files', {
      pattern: 'module0',
      path: 'src/module0.ts',
    }, truncDir)
    expect(r.success).toBe(true)
    // Short output should NOT have truncation markers
    expect(r.output).not.toContain('truncated')
  })
})

// ── Error Self-Correction Hints ─────────────────────────────────

describe('Error messages include recovery hints', () => {
  const errDir = join(tmpdir(), `orca-errhint-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(errDir, { recursive: true })
    writeFileSync(join(errDir, 'existing.txt'), 'hello world\n')
  })

  afterAll(() => {
    try { rmSync(errDir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('14.13 read_file "not found" suggests list_directory', () => {
    const r = executeTool('read_file', { path: 'nonexistent.ts' }, errDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('list_directory')
  })

  it('14.14 edit_file "not found" suggests read_file', () => {
    const r = executeTool('edit_file', {
      path: 'existing.txt',
      old_string: 'MISSING TEXT',
      new_string: 'replacement',
    }, errDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('read_file')
    expect(r.output).toContain('exact')
  })

  it('14.15 edit_file "multiple matches" suggests more context', () => {
    writeFileSync(join(errDir, 'dup.txt'), 'same\nsame\n')
    const r = executeTool('edit_file', {
      path: 'dup.txt',
      old_string: 'same',
      new_string: 'different',
    }, errDir)
    expect(r.success).toBe(false)
    expect(r.output).toContain('surrounding lines')
  })
})
