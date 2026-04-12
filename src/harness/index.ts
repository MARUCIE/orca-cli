/**
 * Orca Harness — runtime intelligence layer.
 *
 * Closes the 20-point gap between model capability and agent delivery.
 * Ported from AI-Fleet core/harness/ (Python → TypeScript).
 */

export { LoopDetector } from './loop-detector.js'
export type { LoopAction, LoopState } from './loop-detector.js'

export { ContextMonitor } from './context-monitor.js'
export type { RiskLevel, ContextSnapshot } from './context-monitor.js'

export { classifyError, isRetryable, getRecoverySuggestion } from './error-classifier.js'
export type { ErrorCategory, ClassifiedError } from './error-classifier.js'

export { runVerificationGate, quickVerify } from './verification-gate.js'
export type { CheckName, CheckResult, VerificationResult } from './verification-gate.js'
