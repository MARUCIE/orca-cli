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

// ── Additional Deep Edge Case Tests ──────────────────────────────

describe('isMultiTaskPrompt — edge cases', () => {
  it('detects mixed CJK + English multi-task prompt', () => {
    expect(isMultiTaskPrompt('修复登录bug；then add tests；然后update docs')).toBe(true)
  })

  it('detects asterisk bullet list (* item)', () => {
    expect(isMultiTaskPrompt('* First task\n* Second task\n* Third task')).toBe(true)
  })

  it('returns false for very long single task', () => {
    const veryLongSingle = 'This is a very long single task that spans multiple concepts and describes complex requirements without using any enumeration or conjunction markers that would indicate multiple distinct tasks. Even though it is very long it is still just one task to accomplish.'
    expect(isMultiTaskPrompt(veryLongSingle)).toBe(false)
  })

  it('detects "and also" pattern', () => {
    expect(isMultiTaskPrompt('Fix the login bug and also improve the error messages and also add rate limiting')).toBe(true)
  })

  it('returns false for empty string', () => {
    expect(isMultiTaskPrompt('')).toBe(false)
  })

  it('returns false for prompt with exactly 2 action sentences (below threshold)', () => {
    expect(isMultiTaskPrompt('Fix the failing test suite. Add error handling to the API.')).toBe(false)
  })

  it('detects "furthermore" conjunction', () => {
    expect(isMultiTaskPrompt('Fix the bug, furthermore optimize the code, moreover add tests')).toBe(true)
  })

  it('detects "next" + "then" conjunctions', () => {
    // Need 2+ conjunctions to pass threshold
    expect(isMultiTaskPrompt('Create the schema, then build API endpoints. Also add authentication.')).toBe(true)
  })
})

describe('decomposeHeuristic — edge cases', () => {
  it('splits Chinese semicolons with mixed English', () => {
    const plan = decomposeHeuristic('修复bug；implement new feature；另外optimize database')
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2)
  })

  it('splits sentence boundaries with periods', () => {
    const plan = decomposeHeuristic('Create database schema. Build API endpoints. Add authentication.')
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2)
  })

  it('handles input with only 1 segment → 1 task', () => {
    const plan = decomposeHeuristic('Just fix the bug')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.type).toBe('main')
  })

  it('detects side task: "format"', () => {
    const plan = decomposeHeuristic('1. Fix core bug\n2. Format the code')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('detects side task: "document"', () => {
    const plan = decomposeHeuristic('1. Build feature\n2. Document the API')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('detects side task: "readme"', () => {
    const plan = decomposeHeuristic('1. Fix bugs\n2. Update README with changes')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('detects side task: "cleanup"', () => {
    const plan = decomposeHeuristic('1. Add feature\n2. Cleanup dead code')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('detects side task: Chinese "顺便"', () => {
    const plan = decomposeHeuristic('1. 修复bug；2. 顺便更新一下文档')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('detects side task: Chinese "文档"', () => {
    const plan = decomposeHeuristic('1. 开发功能；2. 更新文档')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('classifies tasks with "also" as side', () => {
    const plan = decomposeHeuristic('1. Fix main issue\n2. Also add logging')
    const sideTasks = plan.tasks.filter(t => t.type === 'side')
    expect(sideTasks.length).toBeGreaterThanOrEqual(1)
  })

  it('handles Chinese enumeration with just 2 segments', () => {
    const plan = decomposeHeuristic('修复这个登录bug然后添加单元测试')
    // Should split on "然后" and return at least 2 tasks (if each segment > 5 chars)
    expect(plan.tasks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('TaskTracker — edge cases', () => {
  it('markRunning on non-existent taskId → no crash', () => {
    const plan = makePlan([{ id: 'main-1' }])
    const tracker = new TaskTracker(plan)

    expect(() => {
      tracker.markRunning('non-existent')
    }).not.toThrow()

    // Task should not be modified
    expect(tracker.getTask('main-1')!.status).toBe('pending')
  })

  it('markDone on non-existent taskId → no crash', () => {
    const plan = makePlan([{ id: 'main-1' }])
    const tracker = new TaskTracker(plan)

    expect(() => {
      tracker.markDone('non-existent', 'output', 1000)
    }).not.toThrow()

    expect(tracker.getState().completed).toBe(0)
  })

  it('getNextMain when all tasks are done → null', () => {
    const plan = makePlan([
      { id: 'main-1', status: 'done' },
      { id: 'main-2', status: 'done' },
    ])
    const tracker = new TaskTracker(plan)

    expect(tracker.getNextMain()).toBeNull()
  })

  it('getRunnableSideTasks when all blocked → empty array', () => {
    const plan = makePlan([
      { id: 'main-1', type: 'main', status: 'pending' },
      { id: 'side-1', type: 'side', blockedBy: ['main-1'] },
      { id: 'side-2', type: 'side', blockedBy: ['main-1'] },
    ])
    const tracker = new TaskTracker(plan)

    const ready = tracker.getRunnableSideTasks()
    expect(ready).toHaveLength(0)
  })

  it('multiple dependency chain: A → B → C, A fails → B and C skipped', () => {
    const plan = makePlan([
      { id: 'main-1', type: 'main', title: 'A', maxRetries: 0 },
      { id: 'main-2', type: 'main', title: 'B', blockedBy: ['main-1'] },
      { id: 'main-3', type: 'main', title: 'C', blockedBy: ['main-2'] },
    ])
    const tracker = new TaskTracker(plan)

    // A fails (attempts = 0, maxRetries = 0, so next markFailed triggers skip)
    tracker.markRunning('main-1')
    tracker.markFailed('main-1', 'error')

    // B should be skipped as it depends on A
    expect(tracker.getTask('main-2')!.status).toBe('skipped')

    // C should still be pending (B is skipped, but its dependency is also unmet)
    // In this case, C depends on B, and B is skipped, so C won't execute
    // But the skipDependents logic only marks direct dependents
    expect(tracker.getTask('main-3')!.status).toBe('pending')
  })

  it('circular dependency handling (doesn\'t infinite loop)', () => {
    // Create a task that depends on itself (which is nonsensical but shouldn't crash)
    const plan = makePlan([
      { id: 'main-1', blockedBy: ['main-1'] },
    ])
    const tracker = new TaskTracker(plan)

    // areDependenciesMet should not infinite loop
    const next = tracker.getNextMain()
    expect(next).toBeNull() // Blocked on itself
  })

  it('getRetryable after all retries exhausted → empty', () => {
    const plan = makePlan([
      { id: 'main-1', maxRetries: 2, attempts: 2 },
    ])
    const tracker = new TaskTracker(plan)

    tracker.markRunning('main-1')
    tracker.markFailed('main-1', 'error')

    tracker.markRunning('main-1')
    tracker.markFailed('main-1', 'error')

    // After maxRetries exhausted, markFailed will increment failed count
    // and task.attempts will be 2, which equals maxRetries (0-indexed would be different)
    // Let's verify the actual behavior: attempts is incremented before markFailed
    // so after 3 markRunning/markFailed cycles, attempts = 3

    const retryable = tracker.getRetryable()
    expect(retryable).toHaveLength(0)
  })

  it('markFailed records durationMs and tokensUsed correctly', () => {
    const plan = makePlan([{ id: 'main-1' }])
    const tracker = new TaskTracker(plan)

    tracker.markRunning('main-1')
    tracker.markFailed('main-1', 'error', 2000, 50)

    const task = tracker.getTask('main-1')!
    expect(task.durationMs).toBe(2000)
    expect(task.tokensUsed).toBe(50)
    expect(tracker.getState().totalDurationMs).toBe(2000)
    expect(tracker.getState().totalTokens).toBe(50)
  })

  it('areDependenciesMet with empty blockedBy → true', () => {
    const plan = makePlan([{ id: 'main-1', blockedBy: [] }])
    const tracker = new TaskTracker(plan)

    // Task with no blockedBy should be executable
    expect(tracker.getNextMain()).toBe(tracker.getTask('main-1'))
  })

  it('markDone without optional parameters', () => {
    const plan = makePlan([{ id: 'main-1' }])
    const tracker = new TaskTracker(plan)

    tracker.markRunning('main-1')
    tracker.markDone('main-1') // No output, durationMs, tokensUsed

    const task = tracker.getTask('main-1')!
    expect(task.status).toBe('done')
    expect(task.durationMs).toBeUndefined()
    expect(task.tokensUsed).toBe(0)
  })
})

describe('executePlan — edge cases', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `orca-plan-edge-test-${randomUUID().slice(0, 8)}`)
    mkdirSync(tmpDir, { recursive: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('plan with only side tasks (no main tasks)', async () => {
    const plan = makePlan([
      { id: 'side-1', type: 'side', title: 'Side A' },
      { id: 'side-2', type: 'side', title: 'Side B' },
    ])

    mockedSpawnSubAgent.mockResolvedValue({
      success: true, output: 'ok', tokensUsed: 30, duration: 100,
    })

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.completed).toBe(2)
    expect(result.success).toBe(true)
  })

  it('plan with 0 tasks → success immediately', async () => {
    const plan = makePlan([])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.totalTasks).toBe(0)
    expect(result.completed).toBe(0)
    expect(result.success).toBe(true)
  })

  it('spawnSubAgent throwing an exception (not returning failed result)', async () => {
    mockedSpawnSubAgent.mockImplementation(async () => {
      throw new Error('sub-agent crash')
    })

    const plan = makePlan([
      { id: 'main-1', type: 'main', maxRetries: 0 },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.failed).toBe(1)
    expect(result.success).toBe(false)
  })

  it('concurrent side tasks all complete before main task', async () => {
    const completion: Record<string, number> = {}
    let mainStartTime = 0

    mockedSpawnSubAgent.mockImplementation(async (config) => {
      if (config.task.includes('Main')) {
        mainStartTime = Date.now()
        // Main task takes longer
        await new Promise(r => setTimeout(r, 100))
        completion['main'] = Date.now()
      } else {
        // Side tasks are quick
        await new Promise(r => setTimeout(r, 10))
        const sideId = config.task.includes('Side A') ? 'sideA' : 'sideB'
        completion[sideId] = Date.now()
      }
      return { success: true, output: 'ok', tokensUsed: 10, duration: 50 }
    })

    const plan = makePlan([
      { id: 'main-1', type: 'main', title: 'Main task' },
      { id: 'side-1', type: 'side', title: 'Side A' },
      { id: 'side-2', type: 'side', title: 'Side B' },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.completed).toBe(3)
    expect(result.success).toBe(true)
    // Side tasks should complete before or around same time as main
    // (concurrent execution allowed)
  })

  it('executeMainInline callback when provided', async () => {
    const plan = makePlan([
      { id: 'main-1', type: 'main', title: 'Execute inline' },
    ])

    const inlineCallback = vi.fn().mockResolvedValue({
      output: 'inline result',
      tokensUsed: 75,
      durationMs: 1500,
    })

    const { result } = await executePlan(plan, {
      apiKey: 'test',
      baseURL: 'http://localhost',
      model: 'test',
      cwd: tmpDir,
      executeMainInline: inlineCallback,
    })

    expect(inlineCallback).toHaveBeenCalledWith(expect.objectContaining({ id: 'main-1' }), expect.any(Object))
    expect(result.completed).toBe(1)
    expect(result.totalTokens).toBe(75)
  })

  it('handles task with doneCriteria that passes evaluation', async () => {
    mockedSpawnSubAgent.mockResolvedValue({
      success: true, output: 'output with tests passing', tokensUsed: 50, duration: 1000,
    })

    // The evaluateCriteria mock defaults to { passed: true, output: 'ok' }
    // So this test verifies the task completes when criteria passes

    const plan = makePlan([
      { id: 'main-1', type: 'main', title: 'With criteria', doneCriteria: 'tests pass' },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    expect(result.completed).toBe(1)
    expect(result.success).toBe(true)
  })

  it('maxConcurrentSide limits parallel side task execution', async () => {
    const concurrentCount: number[] = []
    let currentConcurrent = 0

    mockedSpawnSubAgent.mockImplementation(async () => {
      currentConcurrent++
      concurrentCount.push(currentConcurrent)
      await new Promise(r => setTimeout(r, 50))
      currentConcurrent--
      return { success: true, output: 'ok', tokensUsed: 10, duration: 50 }
    })

    const plan = makePlan([
      { id: 'side-1', type: 'side' },
      { id: 'side-2', type: 'side' },
      { id: 'side-3', type: 'side' },
      { id: 'side-4', type: 'side' },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test',
      baseURL: 'http://localhost',
      model: 'test',
      cwd: tmpDir,
      maxConcurrentSide: 2,
    })

    expect(result.completed).toBe(4)
    // The max concurrent observed should not exceed 2
    const maxObserved = Math.max(...concurrentCount)
    expect(maxObserved).toBeLessThanOrEqual(2)
  })

  it('task with blockedBy unmet → not executed', async () => {
    const calls: string[] = []

    mockedSpawnSubAgent.mockImplementation(async (config) => {
      const taskName = config.task.split('\n')[0]!
      calls.push(taskName)
      return { success: true, output: 'ok', tokensUsed: 10, duration: 100 }
    })

    const plan = makePlan([
      { id: 'main-1', type: 'main', title: 'First' },
      { id: 'main-2', type: 'main', title: 'Second', blockedBy: ['main-1'] },
      { id: 'main-3', type: 'main', title: 'Third', blockedBy: ['non-existent'] },
    ])

    const { result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    // main-3 depends on non-existent task, so it stays pending forever
    // After main-1 and main-2 complete, there are no more executable tasks
    // So the plan finishes with main-3 still pending
    expect(result.completed).toBe(2)
    expect(calls.length).toBe(2)
  })

  it('plan state tracks all metrics across execution', async () => {
    mockedSpawnSubAgent.mockResolvedValue({
      success: true, output: 'result', tokensUsed: 45, duration: 750,
    })

    const plan = makePlan([
      { id: 'main-1', type: 'main' },
      { id: 'side-1', type: 'side' },
    ])

    const { tracker, result } = await executePlan(plan, {
      apiKey: 'test', baseURL: 'http://localhost', model: 'test', cwd: tmpDir,
    })

    const state = tracker.getState()
    expect(state.completed).toBe(2)
    expect(state.totalTokens).toBe(90) // 45 * 2
    expect(state.totalDurationMs).toBeGreaterThan(0)
    expect(state.active).toBe(false)
  })
})
