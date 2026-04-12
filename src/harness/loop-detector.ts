/**
 * Loop Detector — Tw93 "stuck-twice-clear" rule in code.
 *
 * Tracks consecutive failures per file/function.
 * After 2 failures on the same target → PIVOT (change strategy).
 * After 3+ failures → ESCALATE (human or sub-agent).
 *
 * Ported from AI-Fleet core/harness/loop_detector.py
 */

export type LoopAction = 'continue' | 'pivot' | 'escalate'

export interface LoopState {
  key: string
  failures: number
  lastError: string
  firstSeenAt: number
}

const PIVOT_THRESHOLD = 2
const ESCALATE_THRESHOLD = 3

const PIVOT_STRATEGIES = [
  'Try a completely different approach — the current path has failed twice.',
  'Read the error output carefully and identify the root cause before retrying.',
  'Search for similar patterns in the codebase that work correctly.',
  'Simplify the change — break it into smaller, independently verifiable steps.',
  'Check if a dependency or prerequisite is missing.',
]

export class LoopDetector {
  private state = new Map<string, LoopState>()

  /**
   * Record a failure. Returns the recommended action.
   */
  recordFailure(file: string, fn: string, error: string): LoopAction {
    const key = `${file}::${fn}`
    const existing = this.state.get(key)

    if (existing) {
      existing.failures++
      existing.lastError = error
    } else {
      this.state.set(key, {
        key,
        failures: 1,
        lastError: error,
        firstSeenAt: Date.now(),
      })
    }

    const failures = this.state.get(key)!.failures

    if (failures >= ESCALATE_THRESHOLD) return 'escalate'
    if (failures >= PIVOT_THRESHOLD) return 'pivot'
    return 'continue'
  }

  /**
   * Record a success — clears failure tracking for the target.
   */
  recordSuccess(file: string, fn: string): void {
    const key = `${file}::${fn}`
    this.state.delete(key)
  }

  /**
   * Get a pivot suggestion based on failure count.
   */
  getPivotSuggestion(file: string, fn: string): string {
    const key = `${file}::${fn}`
    const entry = this.state.get(key)
    if (!entry) return ''
    const idx = (entry.failures - PIVOT_THRESHOLD) % PIVOT_STRATEGIES.length
    return PIVOT_STRATEGIES[idx] || PIVOT_STRATEGIES[0]!
  }

  /**
   * Get failure count for a specific target.
   */
  getFailures(file: string, fn: string): number {
    const key = `${file}::${fn}`
    return this.state.get(key)?.failures || 0
  }

  /**
   * Get all tracked failure states.
   */
  getState(): LoopState[] {
    return Array.from(this.state.values())
  }

  /**
   * Get total failure count across all targets.
   */
  get totalFailures(): number {
    return Array.from(this.state.values()).reduce((sum, s) => sum + s.failures, 0)
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this.state.clear()
  }
}
