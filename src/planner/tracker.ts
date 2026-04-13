/**
 * Task Tracker — visual checklist and status lifecycle.
 *
 * Renders a persistent task list that updates as tasks complete:
 *
 *   ╭─ Plan: 5 tasks (3 main + 2 side) ──────────╮
 *   │ ✓ main-1  Fix failing tests          12.3s  │
 *   │ ● main-2  Add error handling          ...    │
 *   │ ○ main-3  Update API endpoint                │
 *   │ ─── side ───                                 │
 *   │ ✓ side-1  Format code                  3.1s  │
 *   │ ○ side-2  Update README                      │
 *   ╰─ 1/5 done · 0 failed ──────────────────────╯
 */

import type { TaskPlan, PlannedTask, TaskStatus, PlanEvent, PlanEventHandler, PlanEventType, TaskPlanState } from './types.js'

// ── Status Icons ────────────────────────────────────────────────

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending:  '\x1b[90m○\x1b[0m',
  running:  '\x1b[36m●\x1b[0m',
  done:     '\x1b[32m✓\x1b[0m',
  failed:   '\x1b[31m✗\x1b[0m',
  skipped:  '\x1b[90m─\x1b[0m',
}

// ── TaskTracker ─────────────────────────────────────────────────

export class TaskTracker {
  private plan: TaskPlan
  private handlers: PlanEventHandler[] = []
  private state: TaskPlanState

  constructor(plan: TaskPlan) {
    this.plan = plan
    this.state = {
      plan,
      completed: 0,
      failed: 0,
      skipped: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      active: true,
    }
  }

  /** Subscribe to plan events */
  onEvent(handler: PlanEventHandler): void {
    this.handlers.push(handler)
  }

  /** Get current state */
  getState(): Readonly<TaskPlanState> {
    return this.state
  }

  /** Get the plan */
  getPlan(): Readonly<TaskPlan> {
    return this.plan
  }

  /** Get all tasks */
  getTasks(): ReadonlyArray<PlannedTask> {
    return this.plan.tasks
  }

  /** Get a task by ID */
  getTask(id: string): PlannedTask | undefined {
    return this.plan.tasks.find(t => t.id === id)
  }

  // ── Status Transitions ──────────────────────────────────────────

  /** Mark a task as running */
  markRunning(taskId: string): void {
    const task = this.plan.tasks.find(t => t.id === taskId)
    if (!task) return
    task.status = 'running'
    task.attempts++
    this.emit('task_started', taskId, `Started: ${task.title}`)
  }

  /** Mark a task as done */
  markDone(taskId: string, output?: string, durationMs?: number, tokensUsed?: number): void {
    const task = this.plan.tasks.find(t => t.id === taskId)
    if (!task) return
    task.status = 'done'
    task.lastOutput = output?.slice(0, 500)
    task.durationMs = durationMs
    if (tokensUsed) task.tokensUsed += tokensUsed
    this.state.completed++
    if (durationMs) this.state.totalDurationMs += durationMs
    if (tokensUsed) this.state.totalTokens += tokensUsed
    this.emit('task_completed', taskId, `Done: ${task.title}${durationMs ? ` (${(durationMs / 1000).toFixed(1)}s)` : ''}`)
  }

  /** Mark a task as failed */
  markFailed(taskId: string, error?: string, durationMs?: number, tokensUsed?: number): void {
    const task = this.plan.tasks.find(t => t.id === taskId)
    if (!task) return
    task.status = 'failed'
    task.lastOutput = error?.slice(0, 500)
    task.durationMs = durationMs
    if (tokensUsed) task.tokensUsed += tokensUsed
    if (durationMs) this.state.totalDurationMs += durationMs
    if (tokensUsed) this.state.totalTokens += tokensUsed

    if (task.attempts > task.maxRetries) {
      this.state.failed++
      // Skip tasks that depend on this one
      this.skipDependents(taskId)
    }

    this.emit('task_failed', taskId, `Failed: ${task.title}${error ? ` — ${error.slice(0, 100)}` : ''}`)
  }

  /** Mark a task as skipped (dependency failed) */
  markSkipped(taskId: string, reason?: string): void {
    const task = this.plan.tasks.find(t => t.id === taskId)
    if (!task) return
    task.status = 'skipped'
    task.lastOutput = reason
    this.state.skipped++
    this.emit('task_skipped', taskId, `Skipped: ${task.title}${reason ? ` — ${reason}` : ''}`)
  }

  // ── Query ───────────────────────────────────────────────────────

  /** Get the next executable task (dependencies met, status pending) */
  getNextMain(): PlannedTask | null {
    return this.plan.tasks.find(t =>
      t.type === 'main' && t.status === 'pending' && this.areDependenciesMet(t),
    ) || null
  }

  /** Get all side tasks ready to run (dependencies met, status pending) */
  getRunnableSideTasks(): PlannedTask[] {
    return this.plan.tasks.filter(t =>
      t.type === 'side' && t.status === 'pending' && this.areDependenciesMet(t),
    )
  }

  /** Get tasks that can be retried */
  getRetryable(): PlannedTask[] {
    return this.plan.tasks.filter(t =>
      t.status === 'failed' && t.attempts < t.maxRetries,
    )
  }

  /** Check if all tasks are terminal (done/failed/skipped) */
  isComplete(): boolean {
    return this.plan.tasks.every(t =>
      t.status === 'done' || t.status === 'failed' || t.status === 'skipped',
    )
  }

  /** Mark the plan as inactive */
  finish(): void {
    this.state.active = false
    const allDone = this.state.failed === 0 && this.state.skipped === 0
    this.emit(
      allDone ? 'plan_completed' : 'plan_failed',
      undefined,
      allDone
        ? `Plan completed: ${this.state.completed}/${this.plan.tasks.length} tasks done`
        : `Plan finished: ${this.state.completed} done, ${this.state.failed} failed, ${this.state.skipped} skipped`,
    )
  }

  // ── Display ─────────────────────────────────────────────────────

  /**
   * Print the task checklist to stdout.
   * Called after each task completion to show current state.
   */
  printList(): void {
    const mainTasks = this.plan.tasks.filter(t => t.type === 'main')
    const sideTasks = this.plan.tasks.filter(t => t.type === 'side')
    const total = this.plan.tasks.length

    // Header
    const headerText = `Plan: ${total} tasks (${mainTasks.length} main + ${sideTasks.length} side)`
    const boxWidth = Math.max(headerText.length + 4, 50)

    console.log(`\x1b[90m  ╭─ ${headerText} ${'─'.repeat(Math.max(0, boxWidth - headerText.length - 4))}╮\x1b[0m`)

    // Main tasks
    for (const task of mainTasks) {
      console.log(`\x1b[90m  │\x1b[0m ${this.formatTaskLine(task, boxWidth)}`)
    }

    // Side tasks separator (only if there are side tasks)
    if (sideTasks.length > 0) {
      console.log(`\x1b[90m  │ ─── side ${'─'.repeat(Math.max(0, boxWidth - 12))}│\x1b[0m`)
      for (const task of sideTasks) {
        console.log(`\x1b[90m  │\x1b[0m ${this.formatTaskLine(task, boxWidth)}`)
      }
    }

    // Footer
    const doneCount = this.plan.tasks.filter(t => t.status === 'done').length
    const failCount = this.plan.tasks.filter(t => t.status === 'failed').length
    const footerParts = [`${doneCount}/${total} done`]
    if (failCount > 0) footerParts.push(`${failCount} failed`)
    if (this.state.totalDurationMs > 0) {
      footerParts.push(`${(this.state.totalDurationMs / 1000).toFixed(1)}s`)
    }
    const footer = footerParts.join(' · ')
    console.log(`\x1b[90m  ╰─ ${footer} ${'─'.repeat(Math.max(0, boxWidth - footer.length - 4))}╯\x1b[0m`)
  }

  /** Format a single task line for the checklist */
  private formatTaskLine(task: PlannedTask, boxWidth: number): string {
    const icon = STATUS_ICONS[task.status]
    const id = `\x1b[90m${task.id.padEnd(8)}\x1b[0m`

    // Title — color based on status
    let titleColor = '\x1b[0m'
    if (task.status === 'done') titleColor = '\x1b[90m'
    else if (task.status === 'running') titleColor = '\x1b[36m'
    else if (task.status === 'failed') titleColor = '\x1b[31m'
    else if (task.status === 'skipped') titleColor = '\x1b[90m'

    const maxTitleLen = boxWidth - 22
    const title = task.title.length > maxTitleLen
      ? task.title.slice(0, maxTitleLen - 2) + '..'
      : task.title

    // Duration (right-aligned)
    const dur = task.durationMs
      ? `\x1b[90m${(task.durationMs / 1000).toFixed(1)}s\x1b[0m`
      : task.status === 'running' ? '\x1b[90m...\x1b[0m' : ''

    return `${icon} ${id}${titleColor}${title}\x1b[0m  ${dur}`
  }

  /**
   * Get a compact one-line progress summary.
   * Useful for status line integration.
   */
  getProgressLine(): string {
    const total = this.plan.tasks.length
    const done = this.plan.tasks.filter(t => t.status === 'done').length
    const running = this.plan.tasks.filter(t => t.status === 'running').length
    const failed = this.plan.tasks.filter(t => t.status === 'failed').length

    const barLen = 10
    const filled = Math.round((done / total) * barLen)
    const bar = `\x1b[32m${'█'.repeat(filled)}\x1b[90m${'░'.repeat(barLen - filled)}\x1b[0m`

    const parts = [`${bar} ${done}/${total}`]
    if (running > 0) parts.push(`\x1b[36m${running} running\x1b[0m`)
    if (failed > 0) parts.push(`\x1b[31m${failed} failed\x1b[0m`)

    return parts.join('  ')
  }

  // ── Internal ────────────────────────────────────────────────────

  private areDependenciesMet(task: PlannedTask): boolean {
    if (task.blockedBy.length === 0) return true
    return task.blockedBy.every(depId => {
      const dep = this.plan.tasks.find(t => t.id === depId)
      return dep && dep.status === 'done'
    })
  }

  private skipDependents(failedTaskId: string): void {
    const dependents = this.plan.tasks.filter(t =>
      t.blockedBy.includes(failedTaskId) && t.status === 'pending',
    )
    for (const dep of dependents) {
      this.markSkipped(dep.id, `Dependency ${failedTaskId} failed`)
    }
  }

  private emit(type: PlanEventType, taskId: string | undefined, message: string, data?: Record<string, unknown>): void {
    const event: PlanEvent = {
      type,
      timestamp: new Date().toISOString(),
      taskId,
      message,
      data,
    }
    for (const handler of this.handlers) {
      handler(event)
    }
  }
}
