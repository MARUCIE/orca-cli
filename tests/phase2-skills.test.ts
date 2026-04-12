/**
 * Phase 2: Skills — 15 tests
 *
 * Covers:
 *   1. SkillRegistry — loadFromFile, matchTriggers, getGroup, listGroups, groupCount
 *   2. SkillEngine — execute in sequential/pipeline/loop/swarm modes
 *   3. Edge cases — empty registry, no match, malformed JSON
 */

import { describe, it, expect, afterAll } from 'vitest'
import { SkillRegistry } from '../src/skills/registry.js'
import { SkillEngine } from '../src/skills/engine.js'
import type { SkillGroup } from '../src/skills/registry.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

// ── Setup ──────────────────────────────────────────────────────────

const TMP = join(tmpdir(), `orca-skills-test-${randomBytes(6).toString('hex')}`)
mkdirSync(TMP, { recursive: true })

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch { /* best-effort */ }
})

const SAMPLE_GROUPS = {
  groups: {
    'code-quality': {
      name: 'Code Quality Swarm',
      description: 'Lint, review, and test',
      skills: ['linter', 'reviewer', 'tester'],
      triggers: ['code quality', 'review', 'lint'],
      execution: { mode: 'swarm', coreTier: ['linter', 'reviewer'] },
    },
    'deploy-pipeline': {
      name: 'Deploy Pipeline',
      description: 'Build, test, deploy',
      skills: ['builder', 'tester', 'deployer'],
      triggers: ['deploy', 'ci/cd', 'ship'],
      execution: {
        mode: 'pipeline',
        gateCommand: 'echo PASS',
      },
    },
    'iteration-loop': {
      name: 'Iteration Loop',
      description: 'Iterative refinement',
      skills: ['analyzer', 'fixer'],
      triggers: ['iterate', 'refine'],
      execution: {
        mode: 'loop',
        loopSkills: ['analyzer', 'fixer'],
        maxIterations: 3,
        gateCommand: 'echo PASS',
      },
    },
    'simple-seq': {
      name: 'Simple Sequential',
      description: 'One after another',
      skills: ['step-a', 'step-b'],
      triggers: ['simple', 'sequential'],
      execution: { mode: 'sequential' },
    },
  },
}

function writeSampleFile(): string {
  const path = join(TMP, 'skill-groups.json')
  writeFileSync(path, JSON.stringify(SAMPLE_GROUPS), 'utf-8')
  return path
}

// ── SkillRegistry ──────────────────────────────────────────────────

describe('SkillRegistry: skill group management', () => {
  it('S.1 loadFromFile parses valid JSON and populates groups', () => {
    const reg = new SkillRegistry()
    reg.loadFromFile(writeSampleFile())
    expect(reg.groupCount).toBe(4)
  })

  it('S.2 matchTriggers returns matching group (case-insensitive)', () => {
    const reg = new SkillRegistry()
    reg.loadFromFile(writeSampleFile())
    const match = reg.matchTriggers('I need a code quality review')
    expect(match).not.toBeNull()
    expect(match!.id).toBe('code-quality')
  })

  it('S.3 matchTriggers returns null for no match', () => {
    const reg = new SkillRegistry()
    reg.loadFromFile(writeSampleFile())
    expect(reg.matchTriggers('something completely unrelated')).toBeNull()
  })

  it('S.4 getGroup returns group by id', () => {
    const reg = new SkillRegistry()
    reg.loadFromFile(writeSampleFile())
    const group = reg.getGroup('deploy-pipeline')
    expect(group).toBeDefined()
    expect(group!.name).toBe('Deploy Pipeline')
  })

  it('S.5 getGroup returns undefined for unknown id', () => {
    const reg = new SkillRegistry()
    reg.loadFromFile(writeSampleFile())
    expect(reg.getGroup('nonexistent')).toBeUndefined()
  })

  it('S.6 listGroups returns all groups', () => {
    const reg = new SkillRegistry()
    reg.loadFromFile(writeSampleFile())
    const groups = reg.listGroups()
    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.id).sort()).toEqual([
      'code-quality', 'deploy-pipeline', 'iteration-loop', 'simple-seq',
    ])
  })

  it('S.7 empty registry has zero groupCount', () => {
    const reg = new SkillRegistry()
    expect(reg.groupCount).toBe(0)
    expect(reg.listGroups()).toHaveLength(0)
  })

  it('S.8 loadFromFile with malformed JSON does not throw', () => {
    const badPath = join(TMP, 'bad.json')
    writeFileSync(badPath, '{{{not valid json', 'utf-8')
    const reg = new SkillRegistry()
    // Should log warning but not throw
    expect(() => reg.loadFromFile(badPath)).not.toThrow()
    expect(reg.groupCount).toBe(0)
  })

  it('S.9 loadFromFile with missing file does not throw', () => {
    const reg = new SkillRegistry()
    expect(() => reg.loadFromFile('/nonexistent/path.json')).not.toThrow()
    expect(reg.groupCount).toBe(0)
  })
})

// ── SkillEngine ────────────────────────────────────────────────────

describe('SkillEngine: execution modes', () => {
  function makeRegistry(): SkillRegistry {
    const reg = new SkillRegistry()
    reg.loadFromFile(writeSampleFile())
    return reg
  }

  it('S.10 execute sequential mode processes all skills', async () => {
    const reg = makeRegistry()
    const engine = new SkillEngine(reg)
    const group = reg.getGroup('simple-seq')!
    const result = await engine.execute(group, 'test input', TMP)
    expect(result.mode).toBe('sequential')
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[0]).toContain('step-a')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('S.11 execute pipeline mode includes gate result', async () => {
    const reg = makeRegistry()
    const engine = new SkillEngine(reg)
    const group = reg.getGroup('deploy-pipeline')!
    const result = await engine.execute(group, 'deploy now', TMP)
    expect(result.mode).toBe('pipeline')
    expect(result.outputs).toHaveLength(3)
    expect(result.gateResult).toBeDefined()
    expect(result.gateResult!.passed).toBe(true)
  })

  it('S.12 execute loop mode respects maxIterations', async () => {
    const reg = makeRegistry()
    const engine = new SkillEngine(reg)
    // Modify gate to pass immediately
    const group = reg.getGroup('iteration-loop')!
    const result = await engine.execute(group, 'refine this', TMP)
    expect(result.mode).toBe('loop')
    expect(result.iterations).toBeGreaterThanOrEqual(1)
    expect(result.iterations).toBeLessThanOrEqual(3)
  })

  it('S.13 execute swarm mode uses coreTier skills', async () => {
    const reg = makeRegistry()
    const engine = new SkillEngine(reg)
    const group = reg.getGroup('code-quality')!
    const result = await engine.execute(group, 'review code', TMP)
    expect(result.mode).toBe('swarm')
    // coreTier is ['linter', 'reviewer'] — only 2 skills
    expect(result.outputs).toHaveLength(2)
    expect(result.outputs[0]).toContain('linter')
    expect(result.outputs[1]).toContain('reviewer')
  })

  it('S.14 execute sequential with no gate has no gateResult', async () => {
    const reg = makeRegistry()
    const engine = new SkillEngine(reg)
    const group = reg.getGroup('simple-seq')!
    const result = await engine.execute(group, 'go', TMP)
    expect(result.gateResult).toBeUndefined()
  })

  it('S.15 loop with failing gate runs up to maxIterations', async () => {
    const reg = makeRegistry()
    const engine = new SkillEngine(reg)
    const group: SkillGroup = {
      ...reg.getGroup('iteration-loop')!,
      execution: {
        mode: 'loop',
        loopSkills: ['analyzer', 'fixer'],
        maxIterations: 2,
        gateCommand: 'exit 1', // always fail
      },
    }
    const result = await engine.execute(group, 'fix it', TMP)
    expect(result.mode).toBe('loop')
    expect(result.iterations).toBe(2)
    expect(result.gateResult!.passed).toBe(false)
  })
})
