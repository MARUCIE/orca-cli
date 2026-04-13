/**
 * Postmortem Log — structured error pattern capture.
 *
 * Each postmortem records:
 *   - Problem: what happened (error message, symptom)
 *   - Root cause: why it happened (5-Why analysis)
 *   - Fix: what was done
 *   - Prevention: how to avoid in the future
 *   - Triggers: keyword/regex patterns for auto-matching
 *
 * When a new error occurs, the system searches existing postmortems
 * by trigger matching and injects the fix as context.
 *
 * Storage: ~/.orca/knowledge/postmortems/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface Postmortem {
  id: string
  problem: string
  rootCause: string
  fix: string
  prevention: string
  triggers: string[]       // keywords or regex patterns for auto-matching
  project?: string
  files?: string[]         // affected files
  severity: 'low' | 'medium' | 'high' | 'critical'
  createdAt: string
  appliedCount: number     // how many times this fix was auto-applied
}

export class PostmortemLog {
  private dir: string

  constructor() {
    const home = process.env.ORCA_HOME || process.env.HOME || homedir()
    this.dir = join(home, '.orca', 'knowledge', 'postmortems')
    mkdirSync(this.dir, { recursive: true })
  }

  getDir(): string { return this.dir }

  /** Record a new postmortem */
  record(pm: Omit<Postmortem, 'id' | 'createdAt' | 'appliedCount'>): Postmortem {
    const id = `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const full: Postmortem = {
      ...pm,
      id,
      createdAt: new Date().toISOString(),
      appliedCount: 0,
    }
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(full, null, 2))
    return full
  }

  /** Search postmortems by error text — returns matching postmortems */
  match(errorText: string): Postmortem[] {
    const lower = errorText.toLowerCase()
    const all = this.listAll()
    return all.filter(pm =>
      pm.triggers.some(trigger => {
        try {
          return new RegExp(trigger, 'i').test(errorText)
        } catch {
          return lower.includes(trigger.toLowerCase())
        }
      })
    )
  }

  /** Format matched postmortems as context injection */
  formatForContext(matches: Postmortem[]): string {
    if (matches.length === 0) return ''
    const sections = matches.map(pm =>
      `[POSTMORTEM] ${pm.problem}\n  Root cause: ${pm.rootCause}\n  Fix: ${pm.fix}\n  Prevention: ${pm.prevention}`
    )
    return sections.join('\n\n')
  }

  /** Increment applied count for a postmortem */
  markApplied(id: string): void {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return
    const pm: Postmortem = JSON.parse(readFileSync(path, 'utf-8'))
    pm.appliedCount++
    writeFileSync(path, JSON.stringify(pm, null, 2))
  }

  /** List all postmortems */
  listAll(): Postmortem[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.json'))
    const results: Postmortem[] = []
    for (const file of files) {
      try {
        results.push(JSON.parse(readFileSync(join(this.dir, file), 'utf-8')))
      } catch { /* skip */ }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** List recent postmortems with limit */
  list(limit = 20): Postmortem[] {
    return this.listAll().slice(0, limit)
  }
}
