/**
 * Error Classifier — categorize errors for recovery hints.
 *
 * Classifies tool/API errors into actionable categories and
 * provides specific recovery suggestions.
 *
 * Ported from AI-Fleet core/harness/error_classifier.py
 */

export type ErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'timeout'
  | 'syntax'
  | 'permission'
  | 'network'
  | 'conflict'
  | 'resource'
  | 'unknown'

export interface ClassifiedError {
  category: ErrorCategory
  suggestion: string
  retryable: boolean
  retryDelay?: number  // ms, if retryable
}

interface ErrorPattern {
  pattern: RegExp
  category: ErrorCategory
  suggestion: string
  retryable: boolean
  retryDelay?: number
}

const PATTERNS: ErrorPattern[] = [
  // Auth errors
  { pattern: /401|unauthorized|invalid.?api.?key|authentication/i, category: 'auth', suggestion: 'Check your API key. Run `orca doctor` to verify provider configuration.', retryable: false },
  { pattern: /403|forbidden|access.?denied/i, category: 'permission', suggestion: 'You do not have permission for this operation. Check file permissions or API access level.', retryable: false },

  // Rate limiting
  { pattern: /429|rate.?limit|too.?many.?requests|quota/i, category: 'rate_limit', suggestion: 'Rate limited. Wait before retrying, or switch to a different provider.', retryable: true, retryDelay: 5000 },

  // Not found
  { pattern: /404|not.?found|no.?such.?file|enoent/i, category: 'not_found', suggestion: 'Resource not found. Use list_directory or search_files to verify the path.', retryable: false },

  // Timeout
  { pattern: /timeout|timed?.?out|etimedout|econnreset/i, category: 'timeout', suggestion: 'Request timed out. The operation may have been too large. Try splitting it.', retryable: true, retryDelay: 2000 },

  // Syntax / Parse errors
  { pattern: /syntax.?error|unexpected.?token|parse.?error|json.?parse/i, category: 'syntax', suggestion: 'Syntax error in the input. Read the file again to get the exact content before editing.', retryable: false },

  // Network errors
  { pattern: /econnrefused|enetunreach|enotfound|dns|network/i, category: 'network', suggestion: 'Network error. Check your internet connection and provider endpoint.', retryable: true, retryDelay: 3000 },

  // Conflict errors
  { pattern: /conflict|merge.?conflict|already.?exists|duplicate/i, category: 'conflict', suggestion: 'Conflict detected. Read the current state before attempting to modify.', retryable: false },

  // Resource exhaustion
  { pattern: /out.?of.?memory|oom|disk.?full|no.?space|enomem/i, category: 'resource', suggestion: 'System resources exhausted. Free up space or memory before retrying.', retryable: false },
]

/**
 * Classify an error string into a category with recovery suggestion.
 */
export function classifyError(error: string): ClassifiedError {
  for (const p of PATTERNS) {
    if (p.pattern.test(error)) {
      return {
        category: p.category,
        suggestion: p.suggestion,
        retryable: p.retryable,
        retryDelay: p.retryDelay,
      }
    }
  }

  return {
    category: 'unknown',
    suggestion: 'Unexpected error. Read the full error message and try a different approach.',
    retryable: false,
  }
}

/**
 * Check if an error is retryable.
 */
export function isRetryable(error: string): boolean {
  return classifyError(error).retryable
}

/**
 * Get just the recovery suggestion for an error.
 */
export function getRecoverySuggestion(error: string): string {
  return classifyError(error).suggestion
}
