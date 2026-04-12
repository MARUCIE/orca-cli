/**
 * Knowledge Compounder — evaluates whether a fix should become a DNA capsule.
 *
 * Only novel fix patterns get solidified; duplicates are rejected to keep
 * the registry compact and high-signal.
 */

import { DNARegistry } from './dna.js'
import type { DNACapsule } from './dna.js'

export interface CompoundingResult {
  capsuleCreated: boolean
  capsule?: DNACapsule
  reason: string
}

export class KnowledgeCompounder {
  constructor(private registry: DNARegistry) {}

  /**
   * Attempt to compound a fix into a DNA capsule.
   * Only creates if the fix pattern is novel (not already in registry).
   */
  compound(fix: {
    error: string
    solution: string
    file: string
    evidence: string
  }): CompoundingResult {
    const triggers = this.extractTriggers(fix.error)

    if (this.hasSimilar(triggers)) {
      return {
        capsuleCreated: false,
        reason: 'Similar capsule already exists in registry',
      }
    }

    const capsule = this.registry.solidify({
      type: 'fix-pattern',
      triggers,
      content: `${fix.error} -> ${fix.solution} (${fix.file})`,
      evidence: [fix.evidence],
    })

    return {
      capsuleCreated: true,
      capsule,
      reason: 'Novel fix pattern solidified',
    }
  }

  /** Check if a similar capsule already exists */
  hasSimilar(triggers: string[]): boolean {
    for (const trigger of triggers) {
      const results = this.registry.search(trigger)
      if (results.length > 0) {
        // Check overlap: if any result has > 50% trigger overlap, it's similar
        for (const capsule of results) {
          const overlap = triggers.filter((t) =>
            capsule.triggers.some((ct) => ct.toLowerCase().includes(t.toLowerCase()))
          )
          if (overlap.length > triggers.length * 0.5) {
            return true
          }
        }
      }
    }
    return false
  }

  private extractTriggers(error: string): string[] {
    // Split error string into meaningful keywords (3+ chars, deduplicated)
    return [
      ...new Set(
        error
          .split(/[\s:,.\-/()[\]{}]+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length >= 3)
      ),
    ]
  }
}
