/**
 * Goal-Loop Controller — criteria-driven autonomous execution.
 *
 * Runs an agent in a loop until:
 *   1. Done-criteria matches (regex, test command, or LLM-judge)
 *   2. Max iterations reached (safety)
 *   3. Loop detector triggers escalation (stuck)
 *
 * Integration:
 *   - `orca run --done-when "tests pass"` activates goal-loop mode
 *   - Uses LoopDetector for stuck detection
 *   - Uses ContextMonitor for context health
 */

import { execSync } from 'node:child_process'
import { LoopDetector } from './loop-detector.js'
import { chatOnce } from '../providers/openai-compat.js'

// ── Types ────────────────────────────────────────────────────────

export type DoneCriteriaType = 'regex' | 'command' | 'judge'

export interface DoneCriteria {
  type: DoneCriteriaType
  /** For regex: pattern to match in output. For command: shell command. For judge: prompt. */
  value: string
}

export interface GoalLoopConfig {
  /** Maximum iterations before forced stop */
  maxIterations: number
  /** Done criteria */
  doneCriteria: DoneCriteria
  /** Working directory for command execution */
  cwd: string
  /** API options — required for 'judge' criteria type */
  apiOptions?: { apiKey: string; baseURL: string; model: string }
  /** Callback for each iteration start */
  onIterationStart?: (iteration: number, maxIterations: number) => void
  /** Callback for each iteration result */
  onIterationDone?: (iteration: number, passed: boolean, output: string) => void
  /** Callback when loop completes */
  onComplete?: (result: GoalLoopResult) => void
}

export interface GoalLoopResult {
  success: boolean
  iterations: number
  reason: 'criteria_met' | 'max_iterations' | 'stuck' | 'error'
  lastOutput: string
  totalDurationMs: number
}

// ── Criteria Parsing ─────────────────────────────────────────────

/**
 * Parse a done-when string into structured criteria.
 *
 * Formats:
 *   "tests pass"           → command: "npm test"
 *   "lint clean"           → command: "npm run lint"
 *   "/pattern/"            → regex: pattern
 *   "typecheck passes"     → command: "npx tsc --noEmit"
 *   "build succeeds"       → command: "npm run build"
 *   "exit 0: <cmd>"        → command: <cmd>
 *   Anything else           → regex match on output
 */
export function parseDoneCriteria(input: string): DoneCriteria {
  const lower = input.toLowerCase().trim()

  // Explicit command format: "exit 0: <cmd>"
  if (lower.startsWith('exit 0:')) {
    return { type: 'command', value: input.slice(7).trim() }
  }

  // Regex format: "/pattern/"
  if (input.startsWith('/') && input.endsWith('/') && input.length > 2) {
    return { type: 'regex', value: input.slice(1, -1) }
  }

  // Common shortcuts
  if (lower.includes('test') && lower.includes('pass')) {
    return { type: 'command', value: 'npm test' }
  }
  if (lower.includes('lint') && (lower.includes('clean') || lower.includes('pass'))) {
    return { type: 'command', value: 'npm run lint' }
  }
  if (lower.includes('typecheck') || lower.includes('type check') || lower.includes('tsc')) {
    return { type: 'command', value: 'npx tsc --noEmit' }
  }
  if (lower.includes('build') && (lower.includes('succeed') || lower.includes('pass'))) {
    return { type: 'command', value: 'npm run build' }
  }

  // Default: treat as regex on agent output
  return { type: 'regex', value: input }
}

// ── Criteria Evaluation ──────────────────────────────────────────

/**
 * Check if done criteria is satisfied.
 * Returns { passed: true/false, output: string }
 *
 * For 'judge' type: requires apiOptions. Asks an LLM to evaluate whether
 * the agent output satisfies the criteria. Expects "PASS" or "FAIL" in response.
 */
export async function evaluateCriteria(
  criteria: DoneCriteria,
  agentOutput: string,
  cwd: string,
  apiOptions?: { apiKey: string; baseURL: string; model: string },
): Promise<{ passed: boolean; output: string }> {
  switch (criteria.type) {
    case 'regex': {
      try {
        const regex = new RegExp(criteria.value, 'i')
        const match = regex.test(agentOutput)
        return { passed: match, output: match ? `Matched: /${criteria.value}/` : `No match for /${criteria.value}/` }
      } catch {
        return { passed: false, output: `Invalid regex: ${criteria.value}` }
      }
    }

    case 'command': {
      try {
        const output = execSync(criteria.value, {
          cwd,
          encoding: 'utf-8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        return { passed: true, output: output.trim().slice(0, 500) }
      } catch (err) {
        const e = err as { stderr?: string; stdout?: string; status?: number }
        const detail = (e.stderr || e.stdout || '').trim().slice(0, 500)
        return { passed: false, output: `Exit ${e.status ?? '?'}: ${detail}` }
      }
    }

    case 'judge': {
      if (!apiOptions) {
        return { passed: false, output: 'Judge criteria requires apiOptions (apiKey, baseURL, model)' }
      }
      try {
        const judgePrompt = `You are a strict pass/fail judge. Evaluate whether the following agent output satisfies the criteria.

Criteria: ${criteria.value}

Agent output (last 2000 chars):
${agentOutput.slice(-2000)}

Respond with exactly one word on the first line: PASS or FAIL
Then a brief explanation on the next line.`
        const result = await chatOnce(
          { apiKey: apiOptions.apiKey, baseURL: apiOptions.baseURL, model: apiOptions.model, systemPrompt: 'You are a binary pass/fail judge. Be strict.' },
          judgePrompt,
        )
        const firstLine = result.text.trim().split('\n')[0]!.trim().toUpperCase()
        const passed = firstLine === 'PASS'
        return { passed, output: `Judge: ${result.text.trim().slice(0, 300)}` }
      } catch (err) {
        return { passed: false, output: `Judge error: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
  }
}

// ── Goal-Loop Runner ─────────────────────────────────────────────

/**
 * Run the goal-loop: execute callback → check criteria → repeat.
 *
 * The caller provides an `executeIteration` function that runs one
 * agent turn and returns its output. The goal-loop handles the
 * criteria checking, stuck detection, and iteration management.
 */
export async function runGoalLoop(
  config: GoalLoopConfig,
  executeIteration: (iteration: number, feedback?: string) => Promise<string>,
): Promise<GoalLoopResult> {
  const startTime = Date.now()
  const loopDetector = new LoopDetector()
  let lastOutput = ''

  for (let i = 1; i <= config.maxIterations; i++) {
    config.onIterationStart?.(i, config.maxIterations)

    // Build feedback from previous iteration's criteria check
    const feedback = i > 1 ? `Previous attempt did not meet criteria. ${lastOutput}` : undefined

    try {
      const agentOutput = await executeIteration(i, feedback)
      lastOutput = agentOutput

      // Check done criteria
      const check = await evaluateCriteria(config.doneCriteria, agentOutput, config.cwd, config.apiOptions)
      config.onIterationDone?.(i, check.passed, check.output)

      if (check.passed) {
        const result: GoalLoopResult = {
          success: true,
          iterations: i,
          reason: 'criteria_met',
          lastOutput: check.output,
          totalDurationMs: Date.now() - startTime,
        }
        config.onComplete?.(result)
        return result
      }

      // Stuck detection
      const action = loopDetector.recordFailure('goal-loop', 'iteration', check.output)
      if (action === 'escalate') {
        const result: GoalLoopResult = {
          success: false,
          iterations: i,
          reason: 'stuck',
          lastOutput: `Stuck after ${i} iterations: ${check.output}`,
          totalDurationMs: Date.now() - startTime,
        }
        config.onComplete?.(result)
        return result
      }
    } catch (err) {
      const result: GoalLoopResult = {
        success: false,
        iterations: i,
        reason: 'error',
        lastOutput: err instanceof Error ? err.message : String(err),
        totalDurationMs: Date.now() - startTime,
      }
      config.onComplete?.(result)
      return result
    }
  }

  const result: GoalLoopResult = {
    success: false,
    iterations: config.maxIterations,
    reason: 'max_iterations',
    lastOutput: `Reached max iterations (${config.maxIterations})`,
    totalDurationMs: Date.now() - startTime,
  }
  config.onComplete?.(result)
  return result
}
