/**
 * Learning Journal — auto-evolution through observation → promotion cycle.
 *
 * Implements the cognitive reflection pattern:
 *   1. Observe: capture raw observations during work
 *   2. Connect: link related observations into hypotheses
 *   3. Evaluate: quality gate (evidence, failure specificity, reuse value)
 *   4. Promote: only high-signal patterns become durable rules
 *   5. Reject: weak anecdotes stay as observations, not rules
 *
 * This is the "auto-evolution" engine that turns error patterns
 * into reusable knowledge without manual intervention.
 *
 * Storage: ~/.orca/knowledge/learning/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type LearningStatus = 'observation' | 'hypothesis' | 'promoted' | 'rejected'

export interface LearningEntry {
  id: string
  status: LearningStatus
  content: string              // the observation or rule
  evidence: string[]           // supporting evidence (error messages, file paths, test results)
  failureMode?: string         // what goes wrong if this rule is ignored
  connections: string[]        // IDs of related entries
  promotedAt?: string          // when promoted to rule
  rejectedReason?: string      // why rejected
  project?: string
  createdAt: string
  updatedAt: string
}

export class LearningJournal {
  private dir: string

  constructor() {
    const home = process.env.ORCA_HOME || process.env.HOME || homedir()
    this.dir = join(home, '.orca', 'knowledge', 'learning')
    mkdirSync(this.dir, { recursive: true })
  }

  getDir(): string { return this.dir }

  /** Record a new observation */
  observe(content: string, evidence: string[] = [], project?: string): LearningEntry {
    const id = `learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const entry: LearningEntry = {
      id,
      status: 'observation',
      content,
      evidence,
      connections: [],
      project,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(entry, null, 2))
    return entry
  }

  /** Connect related observations into a hypothesis */
  connect(ids: string[], hypothesis: string): LearningEntry | null {
    const entries = ids.map(id => this.load(id)).filter(Boolean) as LearningEntry[]
    if (entries.length < 2) return null

    const id = `learn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const entry: LearningEntry = {
      id,
      status: 'hypothesis',
      content: hypothesis,
      evidence: entries.flatMap(e => e.evidence),
      connections: ids,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(entry, null, 2))

    // Update connected entries
    for (const e of entries) {
      e.connections.push(id)
      e.updatedAt = new Date().toISOString()
      writeFileSync(join(this.dir, `${e.id}.json`), JSON.stringify(e, null, 2))
    }

    return entry
  }

  /**
   * Evaluate a hypothesis for promotion.
   *
   * Quality gate:
   *   1. Multiple signals? (not a single anecdote)
   *   2. Specific failure mode? (what breaks if ignored)
   *   3. Evidence-backed? (repeated issue, user correction, test failure)
   *   4. Reusable? (applies across sessions, not one-off)
   */
  evaluate(id: string): { shouldPromote: boolean; reason: string } {
    const entry = this.load(id)
    if (!entry) return { shouldPromote: false, reason: 'Entry not found' }
    if (entry.status !== 'hypothesis') return { shouldPromote: false, reason: 'Only hypotheses can be promoted' }

    const issues: string[] = []

    // Multiple signals?
    if (entry.connections.length < 2 && entry.evidence.length < 2) {
      issues.push('single anecdote — need multiple signals')
    }

    // Specific failure mode?
    if (!entry.failureMode) {
      issues.push('no failure mode specified — what breaks if this is ignored?')
    }

    // Evidence quality?
    if (entry.evidence.length === 0) {
      issues.push('no evidence — need error messages, test results, or user corrections')
    }

    if (issues.length > 0) {
      return { shouldPromote: false, reason: issues.join('; ') }
    }

    return { shouldPromote: true, reason: 'Passes quality gate: multiple signals, clear failure mode, evidence-backed' }
  }

  /** Promote a hypothesis to a durable rule */
  promote(id: string, failureMode?: string): LearningEntry | null {
    const entry = this.load(id)
    if (!entry) return null

    if (failureMode) entry.failureMode = failureMode
    entry.status = 'promoted'
    entry.promotedAt = new Date().toISOString()
    entry.updatedAt = new Date().toISOString()

    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(entry, null, 2))
    return entry
  }

  /** Reject a hypothesis with reason */
  reject(id: string, reason: string): LearningEntry | null {
    const entry = this.load(id)
    if (!entry) return null

    entry.status = 'rejected'
    entry.rejectedReason = reason
    entry.updatedAt = new Date().toISOString()

    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(entry, null, 2))
    return entry
  }

  /** Load an entry by id */
  load(id: string): LearningEntry | null {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  }

  /** List entries by status */
  listByStatus(status: LearningStatus, limit = 20): LearningEntry[] {
    return this.listAll()
      .filter(e => e.status === status)
      .slice(0, limit)
  }

  /** Get promoted rules (for system prompt injection) */
  getPromotedRules(): LearningEntry[] {
    return this.listByStatus('promoted', 50)
  }

  /** Format promoted rules for system prompt injection */
  formatRulesForPrompt(): string {
    const rules = this.getPromotedRules()
    if (rules.length === 0) return ''
    const formatted = rules.map(r =>
      `- ${r.content}${r.failureMode ? ` (failure: ${r.failureMode})` : ''}`
    ).join('\n')
    return `## Learned Rules (auto-promoted)\n\n${formatted}`
  }

  /** Search entries by content */
  search(query: string, limit = 10): LearningEntry[] {
    const lower = query.toLowerCase()
    return this.listAll()
      .filter(e => e.content.toLowerCase().includes(lower) || e.evidence.some(ev => ev.toLowerCase().includes(lower)))
      .slice(0, limit)
  }

  /** List all entries */
  listAll(): LearningEntry[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.json'))
    const results: LearningEntry[] = []
    for (const file of files) {
      try {
        results.push(JSON.parse(readFileSync(join(this.dir, file), 'utf-8')))
      } catch { /* skip */ }
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
