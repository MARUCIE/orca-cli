/**
 * Skill Group Registry: loads skill-groups.json and matches user input to groups.
 *
 * Groups define execution modes (swarm, pipeline, loop, sequential) and
 * trigger keywords for automatic routing.
 */

import { readFileSync } from 'node:fs'
import { logWarning } from '../logger.js'

// ── Types ────────────────────────────────────────────────────────

export type ExecutionMode = 'swarm' | 'pipeline' | 'loop' | 'sequential'

export interface SkillGroup {
  id: string
  name: string
  description: string
  skills: string[]
  triggers: string[]
  execution: {
    mode: ExecutionMode
    coreTier?: string[]
    extendedTier?: string[]
    loopSkills?: string[]
    maxIterations?: number
    gateCommand?: string
    rolePerSkill?: Record<string, string>
  }
}

// ── Registry ─────────────────────────────────────────────────────

export class SkillRegistry {
  private groups = new Map<string, SkillGroup>()

  /** Load skill groups from a JSON file. Malformed entries are skipped. */
  loadFromFile(path: string): void {
    let raw: string
    try {
      raw = readFileSync(path, 'utf-8')
    } catch (err) {
      logWarning(`Failed to read skill-groups file: ${path}`, { error: String(err) })
      return
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(raw)
    } catch (err) {
      logWarning(`Invalid JSON in skill-groups file: ${path}`, { error: String(err) })
      return
    }

    const groups = (data.groups ?? data) as Record<string, unknown>
    for (const [id, entry] of Object.entries(groups)) {
      try {
        const g = entry as Record<string, unknown>
        const group: SkillGroup = {
          id,
          name: String(g.name ?? id),
          description: String(g.description ?? ''),
          skills: Array.isArray(g.skills) ? (g.skills as string[]) : [],
          triggers: Array.isArray(g.triggers) ? (g.triggers as string[]) : [],
          execution: parseExecution(g.execution),
        }
        this.groups.set(id, group)
      } catch (err) {
        logWarning(`Skipping malformed skill group: ${id}`, { error: String(err) })
      }
    }
  }

  /** Match user input against triggers. Returns the first matching group or null. */
  matchTriggers(input: string): SkillGroup | null {
    const lower = input.toLowerCase()
    for (const group of this.groups.values()) {
      for (const trigger of group.triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          return group
        }
      }
    }
    return null
  }

  /** Get a group by its ID. */
  getGroup(id: string): SkillGroup | undefined {
    return this.groups.get(id)
  }

  /** List all loaded groups. */
  listGroups(): SkillGroup[] {
    return [...this.groups.values()]
  }

  get groupCount(): number {
    return this.groups.size
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function parseExecution(raw: unknown): SkillGroup['execution'] {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'sequential' }
  }
  const e = raw as Record<string, unknown>
  return {
    mode: (e.mode as ExecutionMode) ?? 'sequential',
    coreTier: Array.isArray(e.coreTier) ? (e.coreTier as string[]) : undefined,
    extendedTier: Array.isArray(e.extendedTier) ? (e.extendedTier as string[]) : undefined,
    loopSkills: Array.isArray(e.loopSkills) ? (e.loopSkills as string[]) : undefined,
    maxIterations: typeof e.maxIterations === 'number' ? e.maxIterations : undefined,
    gateCommand: typeof e.gateCommand === 'string' ? e.gateCommand : undefined,
    rolePerSkill: (e.rolePerSkill && typeof e.rolePerSkill === 'object')
      ? (e.rolePerSkill as Record<string, string>)
      : undefined,
  }
}
