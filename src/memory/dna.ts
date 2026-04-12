/**
 * DNA Capsule Registry — cross-agent knowledge inheritance.
 *
 * Capsules encode verified fix patterns, skill overrides, and error recovery
 * procedures. Agents search the registry when they encounter unknown errors
 * and solidify new capsules when they discover novel fixes.
 */

import { readFileSync, writeFileSync } from 'node:fs'

export interface DNACapsule {
  id: string
  type: 'fix-pattern' | 'skill-override' | 'error-recovery'
  triggers: string[]
  content: string
  evidence: string[]
  createdAt: string
}

export class DNARegistry {
  private capsules: DNACapsule[] = []

  /** Load capsules from a registry JSON file */
  loadFromFile(path: string): void {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as { capsules: DNACapsule[] }
    this.capsules = data.capsules
  }

  /** Load capsules from an array */
  loadCapsules(capsules: DNACapsule[]): void {
    this.capsules = [...capsules]
  }

  /** Search capsules by query (case-insensitive substring match against triggers + content) */
  search(query: string): DNACapsule[] {
    const q = query.toLowerCase()
    return this.capsules.filter((c) => {
      const triggersMatch = c.triggers.some((t) => t.toLowerCase().includes(q))
      const contentMatch = c.content.toLowerCase().includes(q)
      return triggersMatch || contentMatch
    })
  }

  /** Get prompt injection text for a capsule */
  inherit(capsuleId: string): string | null {
    const capsule = this.capsules.find((c) => c.id === capsuleId)
    if (!capsule) return null
    return `[DNA:${capsule.id}] ${capsule.content}`
  }

  /** Create a new capsule from a fix */
  solidify(fix: {
    type: DNACapsule['type']
    triggers: string[]
    content: string
    evidence: string[]
  }): DNACapsule {
    const capsule: DNACapsule = {
      id: `dna-${Date.now()}`,
      type: fix.type,
      triggers: fix.triggers,
      content: fix.content,
      evidence: fix.evidence,
      createdAt: new Date().toISOString(),
    }
    this.capsules.push(capsule)
    return capsule
  }

  /** Save registry to a JSON file */
  saveToFile(path: string): void {
    writeFileSync(path, JSON.stringify({ capsules: this.capsules }, null, 2), 'utf-8')
  }

  get capsuleCount(): number {
    return this.capsules.length
  }

  listCapsules(): DNACapsule[] {
    return [...this.capsules]
  }
}
