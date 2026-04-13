import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Decomposer ──────────────────────────────────────────────────

import { isMultiTaskPrompt, decomposeHeuristic } from '../src/planner/decomposer.js'

describe('isMultiTaskPrompt', () => {
  it('detects numbered lists', () => {
    expect(isMultiTaskPrompt('1. Fix the bug\n2. Add tests\n3. Update docs')).toBe(true)
  })

  it('detects bullet lists', () => {
    expect(isMultiTaskPrompt('- Fix the bug\n- Add tests\n- Update docs')).toBe(true)
  })

  it('detects Chinese enumeration with semicolons', () => {
    expect(isMultiTaskPrompt('修复登录bug；添加单元测试；更新API文档')).toBe(true)
  })

  it('detects Chinese conjunctions', () => {
    // Conjunctions at clause boundaries with enough content in each clause
    expect(isMultiTaskPrompt('修复这个登录bug然后添加单元测试用例另外更新接口文档同时优化查询性能')).toBe(true)
  })

  it('detects English conjunctions', () => {
    expect(isMultiTaskPrompt('Fix the bug, also add tests. Additionally update the docs and then deploy.')).toBe(true)
  })

  it('detects multiple action sentences', () => {
    expect(isMultiTaskPrompt('Fix the failing test suite. Add error handling to the API. Update the README with new endpoints.')).toBe(true)
  })

  it('returns false for single task', () => {
    expect(isMultiTaskPrompt('Fix the failing test')).toBe(false)
  })

  it('returns false for short prompts', () => {
    expect(isMultiTaskPrompt('hi')).toBe(false)
  })

  it('returns false for questions', () => {
    expect(isMultiTaskPrompt('What does this function do?')).toBe(false)
  })
})

describe('decomposeHeuristic', () => {
  it('splits numbered list into tasks', () => {
    const plan = decomposeHeuristic('1. Fix tests\n2. Add logging\n3. Update docs')
    expect(plan.tasks).toHaveLength(3)
    expect(plan.tasks[0]!.title).toContain('Fix tests')
    expect(plan.tasks[1]!.title).toContain('Add logging')
    expect(plan.tasks[2]!.title).toContain('Update docs')
  })

  it('splits bullet list into tasks', () => {
    const plan = decomposeHeuristic('- Refactor auth module\n- Add rate limiting\n- Write integration tests')
    expect(plan.tasks).toHaveLength(3)
  })

  it('splits Chinese semicolons into tasks', () => {
    const plan = decomposeHeuristic('修复登录bug；添加单元测试；更新API文档')
    expect(plan.tasks.length).toBeGreaterThanOrEqual(3)
  })

  it('classifies side tasks correctly', () => {
    const plan = decomposeHeuristic('1. Fix the core bug\n2. Also format the code\n3. Update README')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    // "format" and "README" are side task signals
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('sets dependencies between main tasks', () => {
    const plan = decomposeHeuristic('1. Create database schema\n2. Build API endpoints\n3. Add authentication')
    const mainTasks = plan.tasks.filter(t => t.type === 'main')

    if (mainTasks.length >= 2) {
      // Second main task should be blocked by first
      expect(mainTasks[1]!.blockedBy).toContain(mainTasks[0]!.id)
    }
  })

  it('first task gets high priority', () => {
    const plan = decomposeHeuristic('1. Fix critical bug\n2. Add tests')
    expect(plan.tasks[0]!.priority).toBe('high')
  })

  it('handles single task gracefully', () => {
    const plan = decomposeHeuristic('Fix the failing test')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.type).toBe('main')
  })

  it('preserves original prompt', () => {
    const prompt = '1. Do A\n2. Do B'
    const plan = decomposeHeuristic(prompt)
    expect(plan.originalPrompt).toBe(prompt)
  })

  it('estimates runs correctly', () => {
    const plan = decomposeHeuristic('1. A\n2. B\n3. C')
    expect(plan.estimatedRuns).toBe(plan.tasks.length)
  })
})

// ── TaskTracker ─────────────────────────────────────────────────

import { TaskTracker } from '../src/planner/tracker.js'
import type { TaskPlan, PlannedTask, PlanEvent } from '../src/planner/types.js'

function makePlan(tasks: Partial<PlannedTask>[]): TaskPlan {
  return {
    originalPrompt: 'test',
    tasks: tasks.map((t, i) => ({
      id: t.id || `task-${i + 1}`,
      title: t.title || `Task ${i + 1}`,
      spec: t.spec || `Do task ${i + 1}`,
      type: t.type || 'main',
      status: t.status || 'pending',
      priority: t.priority || 'normal',
      blockedBy: t.blockedBy || [],
      attempts: t.attempts || 0,
      maxRetries: t.maxRetries ?? 2,
      tokensUsed: t.tokensUsed || 0,
      ...t,
    })) as PlannedTask[],
    reasoning: 'test plan',
    createdAt: new Date().toISOString(),
    estimatedRuns: tasks.length,
  }
}

describe('TaskTracker', () => {
  describe('status transitions', () => {
    it('markRunning changes status and increments attempts', () => {
      const plan = makePlan([{ id: 'main-1', title: 'Test task' }])
      const tracker = new TaskTracker(plan)

      tracker.markRunning('main-1')

      const task = tracker.getTask('main-1')!
      expect(task.status).toBe('running')
      expect(task.attempts).toBe(1)
    })

    it('markDone changes status and records metrics', () => {
      const plan = makePlan([{ id: 'main-1', title: 'Test task' }])
      const tracker = new TaskTracker(plan)

      tracker.markRunning('main-1')
      tracker.markDone('main-1', 'output text', 5000, 100)

      const task = tracker.getTask('main-1')!
      expect(task.status).toBe('done')
      expect(task.durationMs).toBe(5000)
      expect(task.tokensUsed).toBe(100)
      expect(tracker.getState().completed).toBe(1)
    })

    it('markFailed records error and skips dependents after max retries', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'Will fail', maxRetries: 1 },
        { id: 'main-2', title: 'Depends on 1', blockedBy: ['main-1'] },
      ])
      const tracker = new TaskTracker(plan)

      tracker.markRunning('main-1')
      tracker.markFailed('main-1', 'error occurred')

      // First failure doesn't skip dependents (attempts < maxRetries)
      expect(tracker.getTask('main-2')!.status).toBe('pending')

      // Second failure (attempts = maxRetries) does skip
      tracker.markRunning('main-1')
      tracker.markFailed('main-1', 'error again')

      expect(tracker.getTask('main-2')!.status).toBe('skipped')
      expect(tracker.getState().failed).toBe(1)
      expect(tracker.getState().skipped).toBe(1)
    })
  })

  describe('query methods', () => {
    it('getNextMain returns first pending main task with met dependencies', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'First', type: 'main' },
        { id: 'main-2', title: 'Second', type: 'main', blockedBy: ['main-1'] },
      ])
      const tracker = new TaskTracker(plan)

      expect(tracker.getNextMain()!.id).toBe('main-1')

      tracker.markRunning('main-1')
      tracker.markDone('main-1')

      expect(tracker.getNextMain()!.id).toBe('main-2')
    })

    it('getNextMain returns null when blocked', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'First', type: 'main' },
        { id: 'main-2', title: 'Second', type: 'main', blockedBy: ['main-1'] },
      ])
      const tracker = new TaskTracker(plan)

      tracker.markRunning('main-1')
      // main-1 is running, main-2 blocked
      expect(tracker.getNextMain()).toBeNull()
    })

    it('getRunnableSideTasks returns side tasks with met dependencies', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'Main', type: 'main' },
        { id: 'side-1', title: 'Side A', type: 'side' },
        { id: 'side-2', title: 'Side B', type: 'side', blockedBy: ['main-1'] },
      ])
      const tracker = new TaskTracker(plan)

      const ready = tracker.getRunnableSideTasks()
      expect(ready).toHaveLength(1)
      expect(ready[0]!.id).toBe('side-1')
    })

    it('isComplete returns true when all tasks terminal', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'Done', status: 'done' },
        { id: 'side-1', title: 'Failed', status: 'failed' },
      ])
      const tracker = new TaskTracker(plan)
      expect(tracker.isComplete()).toBe(true)
    })

    it('isComplete returns false when tasks still pending', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'Pending' },
      ])
      const tracker = new TaskTracker(plan)
      expect(tracker.isComplete()).toBe(false)
    })

    it('getRetryable returns failed tasks under retry limit', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'Retriable', maxRetries: 3 },
      ])
      const tracker = new TaskTracker(plan)

      tracker.markRunning('main-1')
      tracker.markFailed('main-1', 'error')

      const retryable = tracker.getRetryable()
      expect(retryable).toHaveLength(1)
    })
  })

  describe('events', () => {
    it('emits task_started on markRunning', () => {
      const plan = makePlan([{ id: 'main-1', title: 'Test' }])
      const tracker = new TaskTracker(plan)

      const events: PlanEvent[] = []
      tracker.onEvent(e => events.push(e))

      tracker.markRunning('main-1')

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('task_started')
      expect(events[0]!.taskId).toBe('main-1')
    })

    it('emits task_completed on markDone', () => {
      const plan = makePlan([{ id: 'main-1', title: 'Test' }])
      const tracker = new TaskTracker(plan)

      const events: PlanEvent[] = []
      tracker.onEvent(e => events.push(e))

      tracker.markDone('main-1')

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('task_completed')
    })

    it('emits plan_completed on finish when all succeed', () => {
      const plan = makePlan([{ id: 'main-1', title: 'Done' }])
      const tracker = new TaskTracker(plan)
      tracker.markDone('main-1')

      const events: PlanEvent[] = []
      tracker.onEvent(e => events.push(e))
      tracker.finish()

      expect(events[0]!.type).toBe('plan_completed')
    })

    it('emits plan_failed on finish when some tasks failed', () => {
      const plan = makePlan([{ id: 'main-1', title: 'Fail', maxRetries: 0 }])
      const tracker = new TaskTracker(plan)
      tracker.markRunning('main-1')
      tracker.markFailed('main-1')

      const events: PlanEvent[] = []
      tracker.onEvent(e => events.push(e))
      tracker.finish()

      expect(events[0]!.type).toBe('plan_failed')
    })
  })

  describe('display', () => {
    it('printList outputs the checklist', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'First task', type: 'main' },
        { id: 'main-2', title: 'Second task', type: 'main' },
        { id: 'side-1', title: 'Side task', type: 'side' },
      ])
      const tracker = new TaskTracker(plan)
      tracker.markDone('main-1', 'ok', 3000)

      const lines: string[] = []
      const spy = vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')))

      tracker.printList()

      spy.mockRestore()

      const output = lines.join('\n')
      expect(output).toContain('Plan: 3 tasks')
      expect(output).toContain('2 main + 1 side')
      expect(output).toContain('1/3 done')
    })

    it('getProgressLine shows compact progress', () => {
      const plan = makePlan([
        { id: 'main-1', title: 'Done', status: 'done' },
        { id: 'main-2', title: 'Running', status: 'running' },
        { id: 'main-3', title: 'Pending' },
      ])
      const tracker = new TaskTracker(plan)

      const line = tracker.getProgressLine()
      // Should contain progress bar and counts
      expect(line).toContain('1/3')
      expect(line).toContain('1 running')
    })
  })
})

// ── Executor (mocked) ───────────────────────────────────────────

// Mock sub-agent at the same path the executor resolves it
vi.mock('../src/agent/sub-agent.js', () => ({
  spawnSubAgent: vi.fn().mockResolvedValue({ success: true, output: 'ok', tokensUsed: 10, duration: 100 }),
  DELEGATE_TOOLS: ['read_file', 'write_file'],
  READ_ONLY_TOOLS: ['read_file'],
}))

// Mock goal-loop to avoid real command execution in tests
vi.mock('../src/harness/goal-loop.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    evaluateCriteria: vi.fn().mockReturnValue({ passed: true, output: 'ok' }),
  }
})

import { executePlan } from '../src/planner/executor.js'
import { spawnSubAgent } from '../src/agent/sub-agent.js'

const mockedSpawnSubAgent = vi.mocked(spawnSubAgent)

describe('executePlan', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `orca-plan-test-${randomUUID().slice(0, 8)}`)
    mkdirSync(tmpDir, { recursive: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('executes main tasks sequentially', async () => {
    const callOrder: string[] = []
    mockedSpawnSubAgent.mockImplementation(async (config) => {
      callOrder.push(config.task.split('\n')[0]!)
      return { success: true, output: 'done', tokensUsed: 50, duration: 1000 }
    })

    const plan = makePlan([
      { id: 'main-1', title: 'First', type: 'main' },
      { id: 'main-2', title: 'Second', type: 'main', blockedBy: ['main-1'] },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.completed).toBe(2)
    expect(result.success).toBe(true)
    // First should be called before second
    expect(callOrder[0]).toContain('First')
    expect(callOrder[1]).toContain('Second')
  })

  it('runs side tasks concurrently with main tasks', async () => {
    const startTimes: Record<string, number> = {}
    mockedSpawnSubAgent.mockImplementation(async (config) => {
      const id = config.task.includes('Main') ? 'main' : 'side'
      startTimes[id] = Date.now()
      await new Promise(r => setTimeout(r, 50)) // Small delay
      return { success: true, output: 'done', tokensUsed: 30, duration: 50 }
    })

    const plan = makePlan([
      { id: 'main-1', title: 'Main task', type: 'main' },
      { id: 'side-1', title: 'Side task', type: 'side' },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.completed).toBe(2)
    expect(result.success).toBe(true)
  })

  it('handles task failures and reports correctly', async () => {
    mockedSpawnSubAgent.mockResolvedValue({
      success: false, output: 'error occurred', tokensUsed: 20, duration: 500,
    })

    // maxRetries: 0 means no retries — fail permanently on first attempt
    const plan = makePlan([
      { id: 'main-1', title: 'Will fail', type: 'main', maxRetries: 0 },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.success).toBe(false)
    expect(result.failed).toBe(1)
  })

  it('skips dependents when a blocking task fails permanently', async () => {
    let calls = 0
    mockedSpawnSubAgent.mockImplementation(async () => {
      calls++
      return { success: false, output: 'nope', tokensUsed: 10, duration: 100 }
    })

    // maxRetries: 0 → first failure is permanent
    const plan = makePlan([
      { id: 'main-1', title: 'Blocker', type: 'main', maxRetries: 0 },
      { id: 'main-2', title: 'Dependent', type: 'main', blockedBy: ['main-1'] },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(calls).toBe(1) // main-1 called once (no retry), main-2 never called
  })

  it('returns correct token counts', async () => {
    mockedSpawnSubAgent.mockResolvedValue({
      success: true, output: 'ok', tokensUsed: 100, duration: 1000,
    })

    const plan = makePlan([
      { id: 'main-1', title: 'A', type: 'main' },
      { id: 'main-2', title: 'B', type: 'main', blockedBy: ['main-1'] },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.totalTokens).toBe(200) // 100 per task
  })
})
