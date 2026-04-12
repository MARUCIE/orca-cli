/**
 * Context Monitor — 4-tier utilization tracking.
 *
 * Thresholds from arXiv:2603.05344:
 *   <40% GREEN (OK)
 *   40-50% YELLOW (suggest /compact)
 *   50-60% ORANGE (force /compact)
 *   >60% RED (force /clear + HANDOFF.md)
 *
 * Ported from AI-Fleet core/harness/context_monitor.py
 */

export type RiskLevel = 'green' | 'yellow' | 'orange' | 'red'

export interface ContextSnapshot {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  utilization: number  // 0.0 - 1.0
  risk: RiskLevel
  modelWindow: number
}

const YELLOW_THRESHOLD = 0.40
const ORANGE_THRESHOLD = 0.50
const RED_THRESHOLD = 0.60

export class ContextMonitor {
  private inputTokens = 0
  private outputTokens = 0
  private modelWindow: number

  constructor(modelWindow: number = 200_000) {
    this.modelWindow = modelWindow
  }

  /**
   * Record token usage from a turn.
   */
  recordUsage(inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens
    this.outputTokens += outputTokens
  }

  /**
   * Get current utilization as a fraction (0.0 - 1.0).
   */
  getUtilization(): number {
    const total = this.inputTokens + this.outputTokens
    return Math.min(total / this.modelWindow, 1.0)
  }

  /**
   * Get current risk level.
   */
  getRiskLevel(): RiskLevel {
    const util = this.getUtilization()
    if (util >= RED_THRESHOLD) return 'red'
    if (util >= ORANGE_THRESHOLD) return 'orange'
    if (util >= YELLOW_THRESHOLD) return 'yellow'
    return 'green'
  }

  /**
   * Whether compaction should be triggered.
   */
  shouldCompact(): boolean {
    return this.getUtilization() >= YELLOW_THRESHOLD
  }

  /**
   * Whether a full clear + HANDOFF.md is needed.
   */
  shouldClear(): boolean {
    return this.getUtilization() >= RED_THRESHOLD
  }

  /**
   * Get a full snapshot of current context state.
   */
  getSnapshot(): ContextSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
      utilization: this.getUtilization(),
      risk: this.getRiskLevel(),
      modelWindow: this.modelWindow,
    }
  }

  /**
   * Get a human-readable status string.
   */
  getStatusString(): string {
    const snap = this.getSnapshot()
    const pct = (snap.utilization * 100).toFixed(1)
    const risk = snap.risk.toUpperCase()
    return `${pct}% (${risk}) — ${snap.totalTokens.toLocaleString()} / ${snap.modelWindow.toLocaleString()} tokens`
  }

  /**
   * Update model window (e.g., when switching models).
   */
  setModelWindow(window: number): void {
    this.modelWindow = window
  }

  /**
   * Reset after compaction or clear.
   */
  reset(): void {
    this.inputTokens = 0
    this.outputTokens = 0
  }
}
