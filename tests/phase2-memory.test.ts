/**
 * Phase 2: Memory — 12 tests
 *
 * Covers:
 *   1. DNARegistry — loadCapsules, search, inherit, solidify, saveToFile, loadFromFile
 *   2. KnowledgeCompounder — compound novel fix, compound duplicate, hasSimilar
 *   3. Edge cases — empty registry, no match
 */

import { describe, it, expect, afterAll } from 'vitest'
import { DNARegistry } from '../src/memory/dna.js'
import { KnowledgeCompounder } from '../src/memory/compounder.js'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { DNACapsule } from '../src/memory/dna.js'

// ── Setup ──────────────────────────────────────────────────────────

const TMP = join(tmpdir(), `orca-memory-test-${randomBytes(6).toString('hex')}`)

function setup() {
  mkdirSync(TMP, { recursive: true })
}

setup()

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch { /* best-effort */ }
})

const SAMPLE_CAPSULES: DNACapsule[] = [
  {
    id: 'dna-001',
    type: 'fix-pattern',
    triggers: ['TypeError', 'undefined', 'property'],
    content: 'Check for null before accessing nested properties',
    evidence: ['bug-123'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'dna-002',
    type: 'error-recovery',
    triggers: ['ENOENT', 'file', 'missing'],
    content: 'Create parent directories with recursive: true before writing',
    evidence: ['incident-456'],
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'dna-003',
    type: 'skill-override',
    triggers: ['timeout', 'fetch', 'network'],
    content: 'Add AbortController with 30s timeout to all fetch calls',
    evidence: ['perf-789'],
    createdAt: '2026-01-03T00:00:00.000Z',
  },
]

// ── DNARegistry ────────────────────────────────────────────────────

describe('DNARegistry: capsule management', () => {
  it('M.1 loadCapsules stores capsules and reports correct count', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    expect(reg.capsuleCount).toBe(3)
    expect(reg.listCapsules()).toHaveLength(3)
  })

  it('M.2 search finds capsules by trigger substring (case-insensitive)', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    const results = reg.search('typeerror')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('dna-001')
  })

  it('M.3 search finds capsules by content substring', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    const results = reg.search('AbortController')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('dna-003')
  })

  it('M.4 search returns empty for no match', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    expect(reg.search('xyzzy-nonexistent')).toHaveLength(0)
  })

  it('M.5 inherit returns formatted prompt text', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    const text = reg.inherit('dna-002')
    expect(text).toBe('[DNA:dna-002] Create parent directories with recursive: true before writing')
  })

  it('M.6 inherit returns null for unknown capsule', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    expect(reg.inherit('dna-999')).toBeNull()
  })

  it('M.7 solidify creates capsule with generated id and adds to registry', () => {
    const reg = new DNARegistry()
    const capsule = reg.solidify({
      type: 'fix-pattern',
      triggers: ['import', 'esm'],
      content: 'Use .js extension in ESM imports',
      evidence: ['build-001'],
    })
    expect(capsule.id).toMatch(/^dna-\d+$/)
    expect(capsule.type).toBe('fix-pattern')
    expect(reg.capsuleCount).toBe(1)
  })

  it('M.8 saveToFile and loadFromFile round-trip', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    const filePath = join(TMP, 'registry.json')
    reg.saveToFile(filePath)
    expect(existsSync(filePath)).toBe(true)

    const reg2 = new DNARegistry()
    reg2.loadFromFile(filePath)
    expect(reg2.capsuleCount).toBe(3)
    expect(reg2.listCapsules().map((c) => c.id)).toEqual(['dna-001', 'dna-002', 'dna-003'])
  })

  it('M.9 empty registry returns empty search and zero count', () => {
    const reg = new DNARegistry()
    expect(reg.capsuleCount).toBe(0)
    expect(reg.search('anything')).toHaveLength(0)
    expect(reg.listCapsules()).toHaveLength(0)
  })
})

// ── KnowledgeCompounder ────────────────────────────────────────────

describe('KnowledgeCompounder: fix -> capsule promotion', () => {
  it('M.10 compound novel fix creates capsule', () => {
    const reg = new DNARegistry()
    const comp = new KnowledgeCompounder(reg)
    const result = comp.compound({
      error: 'RangeError: Maximum call stack size exceeded',
      solution: 'Replace recursive algorithm with iterative loop',
      file: 'src/parser.ts',
      evidence: 'bug-555',
    })
    expect(result.capsuleCreated).toBe(true)
    expect(result.capsule).toBeDefined()
    expect(result.capsule!.type).toBe('fix-pattern')
    expect(reg.capsuleCount).toBe(1)
  })

  it('M.11 compound duplicate fix is rejected', () => {
    const reg = new DNARegistry()
    reg.loadCapsules(SAMPLE_CAPSULES)
    const comp = new KnowledgeCompounder(reg)
    // This should match dna-001 (triggers: TypeError, undefined, property)
    const result = comp.compound({
      error: 'TypeError: Cannot read property of undefined',
      solution: 'Add null check',
      file: 'src/utils.ts',
      evidence: 'bug-999',
    })
    expect(result.capsuleCreated).toBe(false)
    expect(result.reason).toContain('already exists')
  })

  it('M.12 hasSimilar returns false for empty registry', () => {
    const reg = new DNARegistry()
    const comp = new KnowledgeCompounder(reg)
    expect(comp.hasSimilar(['brand', 'new', 'error'])).toBe(false)
  })
})
