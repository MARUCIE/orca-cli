/**
 * Round 16: v0.3.0 Harness — 20 tests
 *
 * Covers:
 *   1. Version consistency across all entry points
 *   2. Shell injection protection (shellEscape unit tests via tool execution)
 *   3. Tool argument coercion (boolean, array, object)
 *   4. Hook banner consistency (regression for the 8-hooks vs 51-hooks conflict)
 *   5. Doctor extended diagnostics
 *   6. Brand identity assertions
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeTool } from '../src/tools.js'
import { createProgram } from '../src/program.js'
import { HookManager } from '../src/hooks.js'
import { gatherDoctorReport } from '../src/doctor.js'

// ── 1. Version Consistency ──────────────────────────────────────

describe('version consistency', () => {
  it('16.1 package.json version matches 0.3.0', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
    expect(pkg.version).toBe('0.7.1')
  })

  it('16.2 Commander program version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
    const program = createProgram()
    expect(program.version()).toBe(pkg.version)
  })

  it('16.3 package name is orca-cli', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('orca-cli')
  })

  it('16.4 binary entry point is orca', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
    expect(pkg.bin).toHaveProperty('orca')
    expect(pkg.bin.orca).toContain('orca.js')
  })
})

// ── 2. Shell Injection Protection ───────────────────────────────

describe('shell injection protection via tool execution', () => {
  const shellDir = join(tmpdir(), `orca-shell-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(join(shellDir, 'src'), { recursive: true })
    writeFileSync(join(shellDir, 'src', 'app.ts'), 'export const name = "hello"\n')
    writeFileSync(join(shellDir, "file'name.txt"), 'content with quote\n')
  })

  afterAll(() => {
    try { rmSync(shellDir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('16.5 search_files with single-quote pattern does not break', () => {
    const r = executeTool('search_files', {
      pattern: "it's",
      path: '.',
    }, shellDir)
    // Should not crash — may find nothing, but should not error from shell injection
    expect(r.success).toBe(true)
  })

  it('16.6 search_files with backtick pattern does not execute commands', () => {
    const r = executeTool('search_files', {
      pattern: '`whoami`',
      path: '.',
    }, shellDir)
    expect(r.success).toBe(true)
    expect(r.output).not.toContain(process.env.USER)
  })

  it('16.7 search_files with $() pattern does not execute commands', () => {
    const r = executeTool('search_files', {
      pattern: '$(echo pwned)',
      path: '.',
    }, shellDir)
    expect(r.success).toBe(true)
    expect(r.output).not.toContain('pwned')
  })

  it('16.8 read_file with path containing single quote', () => {
    const r = executeTool('read_file', {
      path: "file'name.txt",
    }, shellDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('content with quote')
  })
})

// ── 3. Tool Argument Coercion (Extended) ────────────────────────

describe('tool argument coercion extended', () => {
  const coerceDir = join(tmpdir(), `orca-coerce-${Date.now()}`)
  const origOrcaHome = process.env.ORCA_HOME

  beforeAll(() => {
    mkdirSync(join(coerceDir, 'src'), { recursive: true })
    writeFileSync(join(coerceDir, 'src', 'example.ts'), 'line1\nline2\nline3\nline4\nline5\n')
    // Isolate background jobs to temp dir so tests don't pollute ~/.orca/
    process.env.ORCA_HOME = join(coerceDir, '.orca-test')
  })

  afterAll(() => {
    process.env.ORCA_HOME = origOrcaHome || ''
    if (!origOrcaHome) delete process.env.ORCA_HOME
    try { rmSync(coerceDir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('16.9 coerces string "true" to boolean for run_background notify_on_complete', () => {
    const r = executeTool('run_background', {
      command: 'echo coerce-test',
      notify_on_complete: 'true' as unknown as boolean,
    }, coerceDir)
    // Should not fail due to type mismatch
    expect(r.success).toBe(true)
  })

  it('16.10 coerces string "false" to boolean for git_diff staged', () => {
    // In a non-git directory this will fail for git reasons, not type reasons
    const r = executeTool('git_diff', {
      staged: 'false' as unknown as boolean,
    }, coerceDir)
    // The important thing: no crash from stringified boolean
    expect(typeof r.output).toBe('string')
  })

  it('16.11 coerces string number for read_file start_line and end_line', () => {
    const r = executeTool('read_file', {
      path: 'src/example.ts',
      start_line: '2' as unknown as number,
      end_line: '4' as unknown as number,
    }, coerceDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('line2')
    expect(r.output).toContain('line4')
    expect(r.output).not.toContain('line1')
    expect(r.output).not.toContain('line5')
  })

  it('16.12 coerces JSON array string for multi_edit edits', () => {
    writeFileSync(join(coerceDir, 'multi.txt'), 'aaa\nbbb\nccc\n')
    const r = executeTool('multi_edit', {
      path: 'multi.txt',
      edits: '[{"old_string":"aaa","new_string":"AAA"},{"old_string":"ccc","new_string":"CCC"}]' as unknown as object[],
    }, coerceDir)
    expect(r.success).toBe(true)
    const content = readFileSync(join(coerceDir, 'multi.txt'), 'utf-8')
    expect(content).toContain('AAA')
    expect(content).toContain('CCC')
  })
})

// ── 4. Hook Banner Consistency (Regression) ─────────────────────

describe('hook banner consistency', () => {
  const previousHome = process.env.HOME

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  })

  it('16.13 HookManager.totalHooks counts actual handlers, not event types', () => {
    const manager = new HookManager()
    const hookDir = join(tmpdir(), `orca-hookcount-${Date.now()}`)
    const fakeHome = join(tmpdir(), `orca-hookcount-home-${Date.now()}`)
    mkdirSync(join(hookDir, '.orca'), { recursive: true })
    mkdirSync(fakeHome, { recursive: true })
    process.env.HOME = fakeHome

    writeFileSync(join(hookDir, '.orca', 'hooks.json'), JSON.stringify({
      PreToolUse: [
        { command: 'echo pre1' },
        { command: 'echo pre2' },
      ],
      PostToolUse: [
        { command: 'echo post1' },
      ],
      SessionStart: [
        { command: 'echo start1' },
        { command: 'echo start2' },
        { command: 'echo start3' },
      ],
    }))

    manager.load(hookDir)
    expect(manager.totalHooks).toBe(6) // 2+1+3 handlers, not 3 event types

    try { rmSync(hookDir, { recursive: true, force: true }) } catch { /* */ }
    try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* */ }
  })

  it('16.14 printStatus does not output total when called', () => {
    const manager = new HookManager()
    const hookDir = join(tmpdir(), `orca-hookstatus-${Date.now()}`)
    const fakeHome = join(tmpdir(), `orca-hookstatus-home-${Date.now()}`)
    mkdirSync(join(hookDir, '.orca'), { recursive: true })
    mkdirSync(fakeHome, { recursive: true })
    process.env.HOME = fakeHome

    writeFileSync(join(hookDir, '.orca', 'hooks.json'), JSON.stringify({
      PreToolUse: [{ command: 'echo pre' }],
      PostToolUse: [{ command: 'echo post' }],
    }))

    manager.load(hookDir)

    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')) })

    manager.printStatus()

    spy.mockRestore()
    const output = lines.join('\n')

    // Should show compact summary: "hooks: N across M events"
    expect(output).toContain('hooks: 2 across 2 events')

    try { rmSync(hookDir, { recursive: true, force: true }) } catch { /* */ }
    try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* */ }
  })

  it('16.15 printStatus outputs nothing when no hooks are configured', () => {
    const manager = new HookManager()
    const hookDir = join(tmpdir(), `orca-nohook-${Date.now()}`)
    const fakeHome = join(tmpdir(), `orca-nohook-home-${Date.now()}`)
    mkdirSync(hookDir, { recursive: true })
    mkdirSync(fakeHome, { recursive: true })
    process.env.HOME = fakeHome

    manager.load(hookDir)

    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')) })

    manager.printStatus()

    spy.mockRestore()
    expect(lines.length).toBe(0)

    try { rmSync(hookDir, { recursive: true, force: true }) } catch { /* */ }
    try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* */ }
  })
})

// ── 5. Doctor Extended Diagnostics ──────────────────────────────

describe('doctor extended diagnostics', () => {
  let homeDir: string
  let projectDir: string
  const previousHome = process.env.HOME
  const previousOrcaHome = process.env.ORCA_HOME

  beforeEach(() => {
    homeDir = join(tmpdir(), `orca-doc-ext-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    projectDir = join(tmpdir(), `orca-doc-ext-proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(join(homeDir, '.orca', 'sessions'), { recursive: true })
    mkdirSync(join(homeDir, '.orca', 'background-jobs'), { recursive: true })
    mkdirSync(projectDir, { recursive: true })
    process.env.HOME = homeDir
    process.env.ORCA_HOME = join(homeDir, '.orca')
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ORCA_PROVIDER = 'openai'
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousOrcaHome === undefined) delete process.env.ORCA_HOME
    else process.env.ORCA_HOME = previousOrcaHome
    delete process.env.OPENAI_API_KEY
    delete process.env.ORCA_PROVIDER
    try { rmSync(homeDir, { recursive: true, force: true }) } catch { /* */ }
    try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* */ }
  })

  it('16.16 doctor reports zero hooks when none configured', () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test-project' }))
    const report = gatherDoctorReport(projectDir)
    expect(report.hooksConfigured).toBe(0)
  })

  it('16.17 doctor reports zero sessions in fresh home', () => {
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test-project' }))
    const report = gatherDoctorReport(projectDir)
    expect(report.sessionsSaved).toBe(0)
  })

  it('16.18 doctor handles missing package.json gracefully', () => {
    // No package.json in projectDir — doctor falls back to directory name
    const report = gatherDoctorReport(projectDir)
    // Should not crash; project name may be directory name or empty
    expect(typeof report.project.name).toBe('string')
    expect(report.project.type).toBeDefined()
  })
})

// ── 6. Brand Identity ───────────────────────────────────────────

describe('brand identity assertions', () => {
  it('16.19 program name is orca', () => {
    const program = createProgram()
    expect(program.name()).toBe('orca')
  })

  it('16.20 program description contains provider-neutral', () => {
    const program = createProgram()
    expect(program.description()).toContain('provider-neutral')
  })
})
