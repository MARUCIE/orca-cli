/**
 * Concurrent Task Executor — runs main tasks sequentially, side tasks in parallel.
 *
 * Execution model:
 *   1. Start all ready side tasks concurrently (spawnSubAgent)
 *   2. Execute the next main task (inline or spawnSubAgent)
 *   3. After main task completes, print checklist and loop
 *   4. When all main tasks done, wait for remaining side tasks
 *   5. Print final checklist
 *
 * Integration points:
 *   - spawnSubAgent: for parallel side task execution
 *   - goal-loop: wraps tasks with doneCriteria in goal-loop
 *   - TaskTracker: visual progress reporting
 */

import { spawnSubAgent, DELEGATE_TOOLS } from '../agent/sub-agent.js'
import type { SubAgentResult } from '../agent/sub-agent.js'
import { parseDoneCriteria, evaluateCriteria } from '../harness/goal-loop.js'
import type { TaskPlan, PlannedTask } from './types.js'
import { TaskTracker } from './tracker.js'

// ── Types ───────────────────────────────────────────────────────

export interface ExecutorConfig {
  /** API key for sub-agent calls */
  apiKey: string
  /** Base URL for the API */
  baseURL: string
  /** Model for executing tasks */
  model: string
  /** Working directory */
  cwd: string
  /** Timeout per task (ms) */
  taskTimeout?: number
  /** Max concurrent side tasks */
  maxConcurrentSide?: number
  /** Callback: execute a main task inline (for REPL integration) */
  executeMainInline?: (task: PlannedTask, tracker: TaskTracker) => Promise<{ output: string; tokensUsed: number; durationMs: number }>
}

export interface ExecutorResult {
  /** Did all tasks complete successfully? */
  success: boolean
  /** Total tasks attempted */
  totalTasks: number
  /** Tasks completed successfully */
  completed: number
  /** Tasks that failed */
  failed: number
  /** Tasks skipped */
  skipped: number
  /** Total tokens used */
  totalTokens: number
  /** Total duration (ms) */
  totalDurationMs: number
}

// ── Executor ────────────────────────────────────────────────────

/**
 * Execute a task plan: main tasks sequential, side tasks concurrent.
 *
 * Returns after all tasks reach a terminal state.
 */
export async function executePlan(
  plan: TaskPlan,
  config: ExecutorConfig,
): Promise<{ tracker: TaskTracker; result: ExecutorResult }> {
  const tracker = new TaskTracker(plan)
  const startTime = Date.now()
  const maxConcurrent = config.maxConcurrentSide ?? 3
  const taskTimeout = config.taskTimeout ?? 120_000

  // Initial checklist display
  tracker.printList()

  // Track running side tasks
  const runningPromises = new Map<string, Promise<void>>()

  // Main loop: execute until all tasks terminal
  while (!tracker.isComplete()) {
    // Launch ready side tasks (up to concurrency limit)
    const readySides = tracker.getRunnableSideTasks()
    for (const sideTask of readySides) {
      if (runningPromises.size >= maxConcurrent) break
      if (runningPromises.has(sideTask.id)) continue

      const promise = executeTaskAsync(sideTask, tracker, config, taskTimeout)
      runningPromises.set(sideTask.id, promise)
      promise.finally(() => runningPromises.delete(sideTask.id))
    }

    // Execute next main task
    const nextMain = tracker.getNextMain()
    if (nextMain) {
      if (config.executeMainInline) {
        // REPL mode: execute inline with streaming
        tracker.markRunning(nextMain.id)
        try {
          const result = await config.executeMainInline(nextMain, tracker)
          // Check doneCriteria if present
          if (nextMain.doneCriteria) {
            const criteria = parseDoneCriteria(nextMain.doneCriteria)
            const check = await evaluateCriteria(criteria, result.output, config.cwd)
            if (check.passed) {
              tracker.markDone(nextMain.id, result.output, result.durationMs, result.tokensUsed)
            } else {
              tracker.markFailed(nextMain.id, check.output, result.durationMs, result.tokensUsed)
            }
          } else {
            tracker.markDone(nextMain.id, result.output, result.durationMs, result.tokensUsed)
          }
        } catch (err) {
          tracker.markFailed(nextMain.id, err instanceof Error ? err.message : String(err))
        }
      } else {
        // Headless mode: execute via sub-agent
        await executeTaskAsync(nextMain, tracker, config, taskTimeout)
      }

      // Print updated checklist after each main task
      console.log()
      tracker.printList()
    } else if (runningPromises.size > 0) {
      // No main task ready, wait for a side task to finish
      await Promise.race(runningPromises.values())
      console.log()
      tracker.printList()
    } else {
      // Check for retryable tasks
      const retryable = tracker.getRetryable()
      if (retryable.length > 0) {
        // Reset status to pending for retry
        for (const task of retryable) {
          task.status = 'pending'
        }
      } else {
        // Deadlock or all terminal — break
        break
      }
    }
  }

  // Wait for any remaining side tasks
  if (runningPromises.size > 0) {
    await Promise.allSettled(runningPromises.values())
    console.log()
    tracker.printList()
  }

  tracker.finish()

  const state = tracker.getState()
  const result: ExecutorResult = {
    success: state.failed === 0 && state.skipped === 0,
    totalTasks: plan.tasks.length,
    completed: state.completed,
    failed: state.failed,
    skipped: state.skipped,
    totalTokens: state.totalTokens,
    totalDurationMs: Date.now() - startTime,
  }

  return { tracker, result }
}

// ── Async Task Execution ────────────────────────────────────────

async function executeTaskAsync(
  task: PlannedTask,
  tracker: TaskTracker,
  config: ExecutorConfig,
  timeout: number,
): Promise<void> {
  tracker.markRunning(task.id)

  const workerPrompt = buildTaskPrompt(task)

  try {
    const result: SubAgentResult = await spawnSubAgent(
      {
        task: workerPrompt,
        model: config.model,
        tools: DELEGATE_TOOLS,
        timeout,
        maxTurns: 15,
        cwd: config.cwd,
      },
      {
        model: config.model,
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      },
    )

    if (result.success) {
      // Check doneCriteria if present
      if (task.doneCriteria) {
        const criteria = parseDoneCriteria(task.doneCriteria)
        const check = await evaluateCriteria(criteria, result.output, config.cwd)
        if (check.passed) {
          tracker.markDone(task.id, result.output, result.duration, result.tokensUsed)
        } else {
          tracker.markFailed(task.id, check.output, result.duration, result.tokensUsed)
        }
      } else {
        tracker.markDone(task.id, result.output, result.duration, result.tokensUsed)
      }
    } else {
      tracker.markFailed(task.id, result.output, result.duration, result.tokensUsed)
    }
  } catch (err) {
    tracker.markFailed(task.id, err instanceof Error ? err.message : String(err))
  }
}

// ── Prompt Building ─────────────────────────────────────────────

function buildTaskPrompt(task: PlannedTask): string {
  const parts = [`Task: ${task.title}\n\nSpec: ${task.spec}`]

  if (task.files?.length) {
    parts.push(`\nFiles to modify: ${task.files.join(', ')}`)
  }

  if (task.doneCriteria) {
    parts.push(`\nDone when: ${task.doneCriteria}`)
  }

  if (task.lastOutput && task.attempts > 1) {
    parts.push(`\nPrevious attempt failed:\n${task.lastOutput}\n\nFix the issues and try again.`)
  }

  parts.push('\nRules:\n- Focus only on this task\n- Write tests if the project has a test framework\n- Commit changes when done')

  return parts.join('\n')
}
