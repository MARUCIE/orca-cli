import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadSkills } from '../src/context.js'
import { createTempProject } from './helpers/temp-project.js'
import { withEnv } from './helpers/env-snapshot.js'

describe('loadSkills()', () => {
  let tempProject: ReturnType<typeof createTempProject>
  let origHome: string | undefined

  beforeEach(() => {
    origHome = process.env.HOME
  })

  afterEach(() => {
    process.env.HOME = origHome
    if (tempProject) {
      tempProject.cleanup()
    }
  })

  function isolated(files: Record<string, string>) {
    tempProject = createTempProject(files)
    process.env.HOME = tempProject.dir
    return tempProject
  }

  it('finds skills in .claude/skills/ subdirectories with SKILL.md', () => {
    isolated({
      '.claude/skills/my-skill/SKILL.md': '# My Skill\n\nThis is a test skill.',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('my-skill')
    expect(skills[0]?.source).toBe('claude')
  })

  it('finds skills in .codex/skills/ subdirectories', () => {
    isolated({
      '.codex/skills/codex-skill/SKILL.md': '# Codex Skill\n\nAnother test skill.',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('codex-skill')
    expect(skills[0]?.source).toBe('codex')
  })

  it('deduplicates duplicate skill names (first source wins)', () => {
    isolated({
      '.claude/skills/duplicate/SKILL.md': '# Duplicate\n\nClaude version.',
      '.codex/skills/duplicate/SKILL.md': '# Duplicate\n\nCodex version.',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills).toHaveLength(1)
    expect(skills[0]?.source).toBe('claude')
  })

  it('extracts description from first non-heading line after frontmatter', () => {
    isolated({
      '.claude/skills/described/SKILL.md': `---
tags: test
---

# Skill Title

This is the description line.
More text below.`,
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills[0]?.description).toBe('This is the description line.')
  })

  it('extracts description from first line when no frontmatter', () => {
    isolated({
      '.claude/skills/simple/SKILL.md': `# My Skill

Direct description without frontmatter.
More text.`,
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills[0]?.description).toBe('Direct description without frontmatter.')
  })

  it('returns empty array for empty skills directory', () => {
    isolated({})

    const skills = loadSkills(tempProject.dir)

    expect(skills).toEqual([])
  })

  it('returns name and source for each skill', () => {
    isolated({
      '.claude/skills/skill1/SKILL.md': '# Skill 1\n\nDescription 1.',
      '.codex/skills/skill2/SKILL.md': '# Skill 2\n\nDescription 2.',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills.every(s => s.name && s.source)).toBe(true)
  })

  it('silently skips non-existent skills directory', () => {
    isolated({
      'some-file.txt': 'content',
    })

    // .claude/skills/ does not exist
    expect(() => {
      loadSkills(tempProject.dir)
    }).not.toThrow()
  })

  it('truncates description to 120 characters', () => {
    isolated({
      '.claude/skills/long/SKILL.md': `# Long Skill

This is a very long description that exceeds one hundred and twenty characters in total length and should be truncated to fit within the limit exactly.`,
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills[0]?.description.length).toBeLessThanOrEqual(120)
  })

  it('uses skill name as fallback description if extraction fails', () => {
    isolated({
      '.claude/skills/nodesc/SKILL.md': '# Nodesc\n\n',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills[0]?.description).toBeDefined()
  })

  it('loads from global HOME/.claude/skills/ for global claude skills', async () => {
    isolated({})

    const globalTemp = createTempProject({
      '.claude/skills/global-skill/SKILL.md': '# Global Skill\n\nFrom home directory.',
    })

    await withEnv({ HOME: globalTemp.dir }, () => {
      const skills = loadSkills(tempProject.dir)
      // Should find the global skill
      expect(skills.some(s => s.name === 'global-skill')).toBe(true)
    })

    globalTemp.cleanup()
  })

  it('loads from .orca/skills/ directory', () => {
    isolated({
      '.orca/skills/orca-skill/SKILL.md': '# Orca Skill\n\nNative format.',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills.some(s => s.name === 'orca-skill' && s.source === 'orca')).toBe(
      true
    )
  })

  it('handles YAML frontmatter correctly', () => {
    isolated({
      '.claude/skills/yaml-test/SKILL.md': `---
name: yaml-test
tags:
  - test
  - yaml
---

# Skill

This is the real description.`,
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills[0]?.description).toBe('This is the real description.')
  })

  it('skips skill subdirectories without SKILL.md', () => {
    isolated({
      '.claude/skills/no-md/README.md': '# No Skill MD here',
      '.claude/skills/has-md/SKILL.md': '# Has MD\n\nDescription.',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('has-md')
  })

  it('ignores hidden skill directories starting with dot', () => {
    isolated({
      '.claude/skills/.hidden/SKILL.md': '# Hidden\n\nShould be skipped.',
      '.claude/skills/visible/SKILL.md': '# Visible\n\nShould load.',
    })

    const skills = loadSkills(tempProject.dir)

    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('visible')
  })
})
