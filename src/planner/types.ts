/**
 * Task Planner — type definitions.
 *
 * Models multi-task decomposition from a single prompt:
 *   Prompt → TaskPlan → MainTasks (sequential) + SideTasks (concurrent)
 *
 * Key concepts:
 *   - Main tasks: blocking, sequential, form the critical path
 *   - Side tasks: non-blocking, can run concurrently with main work
 *   - Dependencies: tasks can declare blockedBy relationships
 *   - Loop integration: long tasks get goal-loop wrappers
 */

// ── Task Classification ─────────────────────────────────────────

export type TaskType = 'main' | 'side'

export type TaskStatus =
  | 'pending'       // Not yet started
  | 'running'       // Currently executing
  | 'done'          // Completed successfully
  | 'failed'        // Failed (may retry)
  | 'skipped'       // Skipped (dependency failed)

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low'

// ── PlannedTask ─────────────────────────────────────────────────

export interface PlannedTask {
  /** Unique task ID: "main-1", "side-1" */
  id: string
  /** Short imperative title: "Fix failing tests" */
  title: string
  /** Detailed spec for the executor */
  spec: string
  /** Main (sequential) or side (concurrent) */
  type: TaskType
  /** Current status */
  status: TaskStatus
  /** Priority level */
  priority: TaskPriority
  /** Task IDs this task depends on (must complete first) */
  blockedBy: string[]
  /** Number of execution attempts */
  attempts: number
  /** Maximum retry attempts */
  maxRetries: number
  /** Done criteria for goal-loop (if applicable) */
  doneCriteria?: string
  /** Files this task is expected to touch */
  files?: string[]
  /** Duration of last execution (ms) */
  durationMs?: number
  /** Executor output (last run) */
  lastOutput?: string
  /** Tokens consumed across all attempts */
  tokensUsed: number
}

// ── TaskPlan ────────────────────────────────────────────────────

export interface TaskPlan {
  /** Original prompt that was decomposed */
  originalPrompt: string
  /** All tasks in execution order (main first, then side) */
  tasks: PlannedTask[]
  /** LLM's reasoning about the decomposition */
  reasoning: string
  /** When the plan was created */
  createdAt: string
  /** Estimated total runs */
  estimatedRuns: number
}

// ── TaskPlanState ───────────────────────────────────────────────

export interface TaskPlanState {
  /** Current plan */
  plan: TaskPlan
  /** Total tasks completed */
  completed: number
  /** Total tasks failed */
  failed: number
  /** Total tasks skipped */
  skipped: number
  /** Total tokens consumed */
  totalTokens: number
  /** Total duration (ms) */
  totalDurationMs: number
  /** Is the plan still executing? */
  active: boolean
}

// ── Events ──────────────────────────────────────────────────────

export type PlanEventType =
  | 'plan_created'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_skipped'
  | 'plan_completed'
  | 'plan_failed'
  | 'checkpoint'    // periodic status update

export interface PlanEvent {
  type: PlanEventType
  timestamp: string
  taskId?: string
  message: string
  data?: Record<string, unknown>
}

export type PlanEventHandler = (event: PlanEvent) => void
