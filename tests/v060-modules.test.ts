/**
 * Round 26-27: v0.6.0 Module Tests
 *
 * Covers:
 *   1. Thread-based memory (ThreadManager) — 16 tests
 *   2. Guidance injection in system prompt — 6 tests
 *   3. Mode registry wiring validation — 6 tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── 1. Thread-based Memory ─────────────────────────────────────

import { ThreadManager } from '../src/memory/threads.js'

describe('ThreadManager: conversation persistence', () => {
  let manager: ThreadManager
  const origHome = process.env.HOME

  beforeAll(() => {
    // Point HOME to temp dir so ThreadManager writes there
    const tmpHome = join(tmpdir(), `orca-thread-test-${Date.now()}`)
    mkdirSync(tmpHome, { recursive: true })
    process.env.HOME = tmpHome
    manager = new ThreadManager()
  })

  afterAll(() => {
    process.env.HOME = origHome
    const dir = manager.getThreadsDir()
    try { rmSync(join(dir, '..'), { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('26.1 creates thread with correct structure', () => {
    const thread = manager.create('Test thread')
    expect(thread.id).toMatch(/^thread-\d+-[a-z0-9]{6}$/)
    expect(thread.title).toBe('Test thread')
    expect(thread.messages).toEqual([])
    expect(thread.createdAt).toBeTruthy()
    expect(thread.updatedAt).toBeTruthy()
  })

  it('26.2 creates thread with initial messages', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]
    const thread = manager.create('With messages', msgs)
    expect(thread.messages.length).toBe(2)
    expect(thread.messages[0]!.content).toBe('hello')
  })

  it('26.3 creates thread with metadata', () => {
    const thread = manager.create('Meta thread', [], { model: 'gpt-4o', cwd: '/tmp' })
    expect(thread.metadata).toEqual({ model: 'gpt-4o', cwd: '/tmp' })
  })

  it('26.4 persists thread to disk', () => {
    const thread = manager.create('Disk thread')
    const filePath = join(manager.getThreadsDir(), `${thread.id}.json`)
    expect(existsSync(filePath)).toBe(true)
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    expect(data.title).toBe('Disk thread')
  })

  it('26.5 loads thread by id', () => {
    const created = manager.create('Load me')
    const loaded = manager.load(created.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.title).toBe('Load me')
    expect(loaded!.id).toBe(created.id)
  })

  it('26.6 load returns null for nonexistent id', () => {
    expect(manager.load('thread-99999-nonexistent')).toBeNull()
  })

  it('26.7 lists threads in updatedAt descending order', () => {
    const t1 = manager.create('First')
    const t2 = manager.create('Second')
    // Force t2 to have a later updatedAt by writing a future timestamp
    const t2Record = manager.load(t2.id)!
    t2Record.updatedAt = new Date(Date.now() + 1000).toISOString()
    const { writeFileSync } = require('node:fs')
    const { join } = require('node:path')
    writeFileSync(join(manager.getThreadsDir(), `${t2.id}.json`), JSON.stringify(t2Record, null, 2))
    const list = manager.list(20)
    const ids = list.map(t => t.id)
    // t2 has a later updatedAt, should appear before t1
    expect(ids.indexOf(t2.id)).toBeLessThan(ids.indexOf(t1.id))
  })

  it('26.8 list respects limit', () => {
    // Create several
    for (let i = 0; i < 5; i++) manager.create(`Bulk ${i}`)
    const limited = manager.list(3)
    expect(limited.length).toBe(3)
  })

  it('26.9 appends messages to existing thread', () => {
    const thread = manager.create('Append test', [{ role: 'user', content: 'start' }])
    const updated = manager.append(thread.id, [
      { role: 'assistant', content: 'response' },
      { role: 'user', content: 'follow up' },
    ])
    expect(updated).not.toBeNull()
    expect(updated!.messages.length).toBe(3)
    expect(updated!.updatedAt >= thread.updatedAt).toBe(true)
  })

  it('26.10 append returns null for nonexistent thread', () => {
    expect(manager.append('thread-fake-000000', [{ role: 'user', content: 'test' }])).toBeNull()
  })

  it('26.11 searches by title', () => {
    manager.create('Debugging the auth flow')
    const results = manager.search('auth')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.title.includes('auth'))).toBe(true)
  })

  it('26.12 searches by message content', () => {
    manager.create('Random topic', [{ role: 'user', content: 'fixing the webpack bundler config' }])
    const results = manager.search('webpack')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('26.13 search returns empty for no match', () => {
    const results = manager.search('zzzznonexistenttermzzzz')
    expect(results.length).toBe(0)
  })

  it('26.14 search respects limit', () => {
    for (let i = 0; i < 3; i++) manager.create(`SearchLimit ${i}`, [{ role: 'user', content: 'common keyword' }])
    const results = manager.search('common keyword', 2)
    expect(results.length).toBe(2)
  })

  it('26.15 deletes thread', () => {
    const thread = manager.create('Delete me')
    expect(manager.delete(thread.id)).toBe(true)
    expect(manager.load(thread.id)).toBeNull()
  })

  it('26.16 delete returns false for nonexistent', () => {
    expect(manager.delete('thread-fake-000000')).toBe(false)
  })
})

// ── 2. Guidance Injection in System Prompt ────────────────────

import { buildSystemPrompt } from '../src/system-prompt.js'

describe('buildSystemPrompt: guidance injection', () => {
  const testDir = join(tmpdir(), `orca-guidance-prompt-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('27.1 system prompt includes guidance section when AGENTS.md present', () => {
    writeFileSync(join(testDir, 'AGENTS.md'), '# Test Agent Guidance\nAlways use TypeScript.')
    const prompt = buildSystemPrompt(testDir)
    expect(prompt).toContain('Project Guidance')
    expect(prompt).toContain('Always use TypeScript')
  })

  it('27.2 system prompt includes CLAUDE.md guidance', () => {
    writeFileSync(join(testDir, 'CLAUDE.md'), '# Project Rules\nRun npm test before commit.')
    const prompt = buildSystemPrompt(testDir)
    expect(prompt).toContain('CLAUDE.md')
    expect(prompt).toContain('npm test before commit')
  })

  it('27.3 system prompt works without any guidance files', () => {
    const emptyDir = join(tmpdir(), `orca-no-guidance-${Date.now()}`)
    mkdirSync(emptyDir, { recursive: true })
    const prompt = buildSystemPrompt(emptyDir)
    expect(prompt).toContain('Orca')
    expect(prompt).toContain('Available Tools')
    rmSync(emptyDir, { recursive: true, force: true })
  })

  it('27.4 includes .orca/rules when present', () => {
    const rulesDir = join(testDir, '.orca', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, '01-safety.md'), '# Safety\nNo force push.')
    const prompt = buildSystemPrompt(testDir)
    expect(prompt).toContain('01-safety.md')
    expect(prompt).toContain('No force push')
  })

  it('27.5 system prompt still contains tool definitions', () => {
    const prompt = buildSystemPrompt(testDir)
    expect(prompt).toContain('read_file')
    expect(prompt).toContain('write_file')
  })

  it('27.6 system prompt still contains working directory', () => {
    const prompt = buildSystemPrompt(testDir)
    expect(prompt).toContain(testDir)
  })
})

// ── 3. Mode Registry Validation ───────────────────────────────

import { ModeRegistry } from '../src/modes/index.js'

describe('ModeRegistry: wiring validation', () => {
  it('27.7 all builtin modes have non-empty description', () => {
    const registry = new ModeRegistry()
    for (const mode of registry.listModes()) {
      expect(mode.description.length).toBeGreaterThan(0)
    }
  })

  it('27.8 code-review and architect modes restrict write tools', () => {
    const registry = new ModeRegistry()
    const review = registry.getMode('code-review')!
    const architect = registry.getMode('architect')!
    expect(review.tools).not.toContain('write_file')
    expect(architect.tools).not.toContain('write_file')
  })

  it('27.9 debug and docs modes allow write tools', () => {
    const registry = new ModeRegistry()
    const debug = registry.getMode('debug')!
    const docs = registry.getMode('docs')!
    expect(debug.tools).toContain('edit_file')
    expect(docs.tools).toContain('write_file')
  })

  it('27.10 default mode has no tool restrictions', () => {
    const registry = new ModeRegistry()
    const def = registry.getMode('default')!
    expect(def.tools).toBeUndefined()
  })

  it('27.11 switching mode changes active', () => {
    const registry = new ModeRegistry()
    registry.switchTo('architect')
    expect(registry.getActive().id).toBe('architect')
    expect(registry.getActive().systemPromptPrefix).toContain('architect mode')
  })

  it('27.12 systemPromptPrefix is non-empty for non-default modes', () => {
    const registry = new ModeRegistry()
    for (const mode of registry.listModes()) {
      if (mode.id !== 'default') {
        expect(mode.systemPromptPrefix.length).toBeGreaterThan(0)
      }
    }
  })
})
