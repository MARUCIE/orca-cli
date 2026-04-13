/**
 * Round 31: Knowledge Management System — 24 tests
 *
 * Covers:
 *   1. NotesManager — 6 tests
 *   2. PostmortemLog — 6 tests
 *   3. PromptRepository — 6 tests
 *   4. LearningJournal — 6 tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { NotesManager } from '../src/knowledge/notes.js'
import { PostmortemLog } from '../src/knowledge/postmortem.js'
import { PromptRepository } from '../src/knowledge/prompts.js'
import { LearningJournal } from '../src/knowledge/learning.js'

const origHome = process.env.HOME

beforeAll(() => {
  const tmpHome = join(tmpdir(), `orca-knowledge-test-${Date.now()}`)
  mkdirSync(tmpHome, { recursive: true })
  process.env.HOME = tmpHome
})

afterAll(() => {
  process.env.HOME = origHome
})

// ── 1. NotesManager ─────────────────────────────────────────────

describe('NotesManager: free-form observations', () => {
  it('31.1 creates note with tags', () => {
    const mgr = new NotesManager()
    const note = mgr.create('Context overflow at 610K tokens', ['bug', 'context'], 'chat.ts')
    expect(note.id).toMatch(/^note-/)
    expect(note.tags).toContain('bug')
    expect(note.source).toBe('chat.ts')
  })

  it('31.2 loads note by id', () => {
    const mgr = new NotesManager()
    const created = mgr.create('Test note')
    const loaded = mgr.load(created.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.content).toBe('Test note')
  })

  it('31.3 lists notes in reverse chronological order', () => {
    const mgr = new NotesManager()
    mgr.create('First')
    mgr.create('Second')
    const list = mgr.list(10)
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list[0]!.createdAt >= list[1]!.createdAt).toBe(true)
  })

  it('31.4 searches by content', () => {
    const mgr = new NotesManager()
    mgr.create('CJK token estimation is wrong', ['bug'])
    const results = mgr.search('CJK')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('31.5 searches by tag', () => {
    const mgr = new NotesManager()
    mgr.create('Something', ['unique-tag-xyz'])
    const results = mgr.search('unique-tag-xyz')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('31.6 deletes note', () => {
    const mgr = new NotesManager()
    const note = mgr.create('Delete me')
    expect(mgr.delete(note.id)).toBe(true)
    expect(mgr.load(note.id)).toBeNull()
  })
})

// ── 2. PostmortemLog ────────────────────────────────────────────

describe('PostmortemLog: structured error patterns', () => {
  it('31.7 records postmortem with all fields', () => {
    const log = new PostmortemLog()
    const pm = log.record({
      problem: '413 Request too large',
      rootCause: 'No pre-send budget check',
      fix: 'Added context guard before API call',
      prevention: 'Built-in PostToolUse context guard',
      triggers: ['413', 'context_length', 'too large'],
      severity: 'critical',
    })
    expect(pm.id).toMatch(/^pm-/)
    expect(pm.appliedCount).toBe(0)
  })

  it('31.8 matches by trigger keyword', () => {
    const log = new PostmortemLog()
    log.record({
      problem: 'Rate limit', rootCause: 'Too many calls', fix: 'Add retry',
      prevention: 'Rate limiter', triggers: ['429', 'rate limit'], severity: 'medium',
    })
    const matches = log.match('Error 429: Too Many Requests')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('31.9 matches by trigger regex', () => {
    const log = new PostmortemLog()
    log.record({
      problem: 'Import error', rootCause: 'Missing .js extension', fix: 'Add .js',
      prevention: 'ESM lint rule', triggers: ['Cannot find module.*\\.ts'], severity: 'low',
    })
    const matches = log.match("Cannot find module './foo.ts'")
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('31.10 formats for context injection', () => {
    const log = new PostmortemLog()
    log.record({
      problem: 'Test failure', rootCause: 'Stale mock', fix: 'Reset mocks in beforeEach',
      prevention: 'Add reset', triggers: ['mock.*stale'], severity: 'low',
    })
    const matches = log.match('mock seems stale')
    const ctx = log.formatForContext(matches)
    expect(ctx).toContain('[POSTMORTEM]')
    expect(ctx).toContain('Reset mocks')
  })

  it('31.11 increments applied count', () => {
    const log = new PostmortemLog()
    const pm = log.record({
      problem: 'Test', rootCause: 'Test', fix: 'Test',
      prevention: 'Test', triggers: ['test-trigger'], severity: 'low',
    })
    log.markApplied(pm.id)
    log.markApplied(pm.id)
    const reloaded = log.listAll().find(p => p.id === pm.id)
    expect(reloaded!.appliedCount).toBe(2)
  })

  it('31.12 lists postmortems', () => {
    const log = new PostmortemLog()
    const list = log.list(5)
    expect(list.length).toBeGreaterThanOrEqual(1)
  })
})

// ── 3. PromptRepository ─────────────────────────────────────────

describe('PromptRepository: versioned prompt templates', () => {
  it('31.13 saves template and extracts variables', () => {
    const repo = new PromptRepository()
    const pt = repo.save('Code review', 'Review {{file}} for {{issues}}', 'code-review')
    expect(pt.variables).toEqual(['file', 'issues'])
    expect(pt.usageCount).toBe(0)
  })

  it('31.14 applies template with variable substitution', () => {
    const repo = new PromptRepository()
    const pt = repo.save('Explain', 'Explain {{concept}} in {{language}}', 'explain')
    const result = repo.apply(pt.id, { concept: 'closures', language: 'TypeScript' })
    expect(result).toBe('Explain closures in TypeScript')
  })

  it('31.15 tracks usage count after apply', () => {
    const repo = new PromptRepository()
    const pt = repo.save('Test', 'Test {{x}}', 'test')
    repo.apply(pt.id, { x: 'value' })
    repo.apply(pt.id, { x: 'value2' })
    const reloaded = repo.load(pt.id)
    expect(reloaded!.usageCount).toBe(2)
  })

  it('31.16 tracks success count', () => {
    const repo = new PromptRepository()
    const pt = repo.save('Debug', 'Debug {{error}}', 'debug')
    repo.markSuccess(pt.id)
    const reloaded = repo.load(pt.id)
    expect(reloaded!.successCount).toBe(1)
  })

  it('31.17 finds by name or category', () => {
    const repo = new PromptRepository()
    repo.save('Refactor helper', 'Refactor {{file}}', 'refactor')
    const found = repo.find('refactor')
    expect(found.length).toBeGreaterThanOrEqual(1)
  })

  it('31.18 returns null for nonexistent apply', () => {
    const repo = new PromptRepository()
    expect(repo.apply('nonexistent-id', {})).toBeNull()
  })
})

// ── 4. LearningJournal ──────────────────────────────────────────

describe('LearningJournal: observation → promotion cycle', () => {
  it('31.19 records observation', () => {
    const journal = new LearningJournal()
    const entry = journal.observe('chars/4 fallback is inaccurate for CJK', ['token-budget.ts error'])
    expect(entry.status).toBe('observation')
    expect(entry.evidence).toContain('token-budget.ts error')
  })

  it('31.20 connects observations into hypothesis', () => {
    const journal = new LearningJournal()
    const obs1 = journal.observe('CJK tokens underestimated')
    const obs2 = journal.observe('Context display shows 3M/200K')
    const hyp = journal.connect([obs1.id, obs2.id], 'CJK-unaware estimation causes context overflow')
    expect(hyp).not.toBeNull()
    expect(hyp!.status).toBe('hypothesis')
    expect(hyp!.connections).toContain(obs1.id)
  })

  it('31.21 evaluate rejects single-anecdote hypothesis', () => {
    const journal = new LearningJournal()
    const obs = journal.observe('Something happened once')
    const hyp = journal.connect([obs.id, obs.id], 'Maybe a pattern')
    // Hypothesis with no failure mode and minimal evidence
    const result = journal.evaluate(hyp!.id)
    expect(result.shouldPromote).toBe(false)
    expect(result.reason).toContain('failure mode')
  })

  it('31.22 promotes hypothesis with evidence', () => {
    const journal = new LearningJournal()
    const obs1 = journal.observe('Bug 1', ['error log 1'])
    const obs2 = journal.observe('Bug 2', ['error log 2'])
    const hyp = journal.connect([obs1.id, obs2.id], 'Always cap fallback at window size')
    // Add failure mode to pass quality gate
    const loaded = journal.load(hyp!.id)!
    loaded.failureMode = 'Context display shows impossible values'
    const promoted = journal.promote(hyp!.id, 'Context display shows impossible values')
    expect(promoted!.status).toBe('promoted')
  })

  it('31.23 formatRulesForPrompt returns promoted rules', () => {
    const journal = new LearningJournal()
    const rules = journal.formatRulesForPrompt()
    // Should contain the rule promoted in 31.22
    expect(rules).toContain('Learned Rules')
    expect(rules).toContain('cap fallback')
  })

  it('31.24 rejects with reason', () => {
    const journal = new LearningJournal()
    const obs = journal.observe('Weak signal')
    const rejected = journal.reject(obs.id, 'Single anecdote, not reusable')
    expect(rejected!.status).toBe('rejected')
    expect(rejected!.rejectedReason).toContain('anecdote')
  })
})
