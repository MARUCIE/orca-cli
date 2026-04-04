/**
 * Retry Intelligence: Prevent infinite tool retry loops.
 *
 * Tracks consecutive failures per tool and injects hints when the
 * model appears stuck. After 2 failures of the same tool with
 * similar args, suggests an alternative approach.
 *
 * This directly addresses the #4 failure mode from production audit:
 * "cascade errors from blind retries."
 */

// ── Types ────────────────────────────────────────────────────────

export interface FailureRecord {
  tool: string
  argsSignature: string
  count: number
  lastError: string
  timestamp: number
}

export interface RetryHint {
  /** Whether the model should be warned */
  shouldWarn: boolean
  /** Hint message to inject into conversation */
  hint: string
  /** Suggested alternative tool/approach */
  suggestion: string | null
}

// ── Retry Tracker ───────────────────────────────────────────────

export class RetryTracker {
  private failures: Map<string, FailureRecord> = new Map()
  private readonly maxRetries: number

  constructor(maxRetries = 2) {
    this.maxRetries = maxRetries
  }

  /**
   * Record a tool failure. Returns a hint if the model should change approach.
   */
  recordFailure(tool: string, args: Record<string, unknown>, error: string): RetryHint {
    const sig = this.argsSignature(tool, args)
    const existing = this.failures.get(sig)

    if (existing) {
      existing.count++
      existing.lastError = error
      existing.timestamp = Date.now()
    } else {
      this.failures.set(sig, {
        tool,
        argsSignature: sig,
        count: 1,
        lastError: error,
        timestamp: Date.now(),
      })
    }

    const record = this.failures.get(sig)!

    if (record.count >= this.maxRetries) {
      const suggestion = this.getSuggestion(tool, args, error)
      return {
        shouldWarn: true,
        hint: `[retry-intelligence] Tool "${tool}" has failed ${record.count} times with similar args. ${suggestion?.suggestion || 'Try a different approach.'}`,
        suggestion: suggestion?.suggestion || null,
      }
    }

    return { shouldWarn: false, hint: '', suggestion: null }
  }

  /** Record a tool success — clears failure tracking for this tool+args */
  recordSuccess(tool: string, args: Record<string, unknown>): void {
    const sig = this.argsSignature(tool, args)
    this.failures.delete(sig)
  }

  /** Get current failure count for a tool */
  getFailureCount(tool: string): number {
    let total = 0
    for (const [key, record] of this.failures) {
      if (record.tool === tool) total += record.count
    }
    return total
  }

  /** Clear all failure records (e.g., on conversation reset) */
  reset(): void {
    this.failures.clear()
  }

  /** Clean up old records (>5 minutes old) */
  cleanup(): void {
    const cutoff = Date.now() - 5 * 60 * 1000
    for (const [key, record] of this.failures) {
      if (record.timestamp < cutoff) this.failures.delete(key)
    }
  }

  // ── Internal ───────────────────────────────────────────────

  private argsSignature(tool: string, args: Record<string, unknown>): string {
    // Create a normalized signature for similar args detection
    // Focus on the "path" or "pattern" — the key identifiers
    const keyArgs = args.path || args.pattern || args.name || args.command || ''
    return `${tool}:${String(keyArgs).slice(0, 100)}`
  }

  private getSuggestion(tool: string, args: Record<string, unknown>, error: string): RetryHint | null {
    // Tool-specific suggestions
    const suggestions: Record<string, string> = {
      edit_file: 'Try read_file first to get the exact current content, then retry with precise old_string.',
      read_file: 'File may have been moved or deleted. Use list_directory or glob_files to find the correct path.',
      search_files: 'Pattern may be too specific. Try a simpler/broader pattern, or use glob_files to find files first.',
      find_definition: 'Name may be misspelled or in an unexpected location. Use search_files with a simpler pattern.',
      run_command: 'Command may have a syntax error or missing dependency. Try running a simpler version first.',
      git_commit: 'There may be no changes to commit. Run git_status first to check.',
      write_file: 'Directory may not exist. Use create_directory first, or check the path with list_directory.',
      multi_edit: 'One or more old_strings may not match. Use read_file to verify current file content before editing.',
    }

    const suggestion = suggestions[tool]
    if (suggestion) {
      return { shouldWarn: true, hint: suggestion, suggestion }
    }

    return null
  }
}
