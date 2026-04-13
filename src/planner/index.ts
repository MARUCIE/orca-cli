/**
 * Task Planner — automatic prompt decomposition + concurrent execution.
 *
 * Core SOTA feature: a single prompt containing multiple tasks is
 * automatically split into main (sequential) + side (concurrent) tasks,
 * displayed as a visual checklist, and executed with progress tracking.
 *
 * Integration:
 *   - /plan in REPL — explicit task decomposition
 *   - Auto-detection via isMultiTaskPrompt() hook
 *   - orca run --plan — headless multi-task execution
 */

export { isMultiTaskPrompt, decomposePrompt, decomposeHeuristic } from './decomposer.js'
export { TaskTracker } from './tracker.js'
export { executePlan } from './executor.js'
export type {
  TaskPlan, PlannedTask, TaskType, TaskStatus, TaskPriority,
  TaskPlanState, PlanEvent, PlanEventHandler, PlanEventType,
} from './types.js'
