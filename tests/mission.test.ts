import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Type imports ────────────────────────────────────────────────

import type {
  Mission, MissionPlan, Milestone, Feature,
  ValidationContract, MissionState, AcceptanceCriterion,
  MissionEvent, MissionPhase, FeatureStatus, MilestoneStatus,
} from '../src/mission/types.js'

// ── Types ───────────────────────────────────────────────────────

describe('Mission types', () => {
  it('AcceptanceCriterion has required fields', () => {
    const criterion: AcceptanceCriterion = {
      id: 'c-1',
      description: 'Tests pass',
      type: 'command',
      value: 'npm test',
      milestoneId: 'm-1',
    }
    expect(criterion.id).toBe('c-1')
    expect(criterion.type).toBe('command')
  })

  it('ValidationContract has version and criteria', () => {
    const contract: ValidationContract = {
      version: 1,
      criteria: [
        { id: 'c-1', description: 'File exists', type: 'file_exists', value: 'src/index.ts', milestoneId: 'm-1' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    expect(contract.version).toBe(1)
    expect(contract.criteria).toHaveLength(1)
    expect(contract.criteria[0]!.type).toBe('file_exists')
  })

  it('Feature tracks status and attempts', () => {
    const feature: Feature = {
      id: 'f-1',
      title: 'Add login endpoint',
      spec: 'Create POST /api/login with JWT authentication',
      criteriaIds: ['c-1', 'c-2'],
      status: 'pending',
      milestoneId: 'm-1',
      attempts: 0,
      files: ['src/api/login.ts'],
    }
    expect(feature.status).toBe('pending')
    expect(feature.attempts).toBe(0)
    expect(feature.files).toContain('src/api/login.ts')
  })

  it('Milestone groups features with validation gate', () => {
    const milestone: Milestone = {
      id: 'm-1',
      title: 'Core API',
      featureIds: ['f-1', 'f-2'],
      status: 'pending',
      validationAttempts: 0,
      maxRetries: 2,
    }
    expect(milestone.featureIds).toHaveLength(2)
    expect(milestone.maxRetries).toBe(2)
  })

  it('MissionState captures lifecycle progress', () => {
    const state: MissionState = {
      phase: 'executing',
      currentMilestoneIndex: 0,
      featuresImplemented: 3,
      featuresValidated: 2,
      featuresFailed: 1,
      totalRuns: 5,
      totalTokens: 12000,
      startedAt: new Date().toISOString(),
    }
    expect(state.phase).toBe('executing')
    expect(state.featuresImplemented).toBe(3)
    expect(state.totalTokens).toBe(12000)
  })

  it('MissionPlan includes estimated runs formula', () => {
    const plan: MissionPlan = {
      milestones: [
        { id: 'm-1', title: 'M1', featureIds: ['f-1', 'f-2'], status: 'pending', validationAttempts: 0, maxRetries: 2 },
        { id: 'm-2', title: 'M2', featureIds: ['f-3'], status: 'pending', validationAttempts: 0, maxRetries: 2 },
      ],
      features: [
        { id: 'f-1', title: 'F1', spec: '', criteriaIds: [], status: 'pending', milestoneId: 'm-1', attempts: 0 },
        { id: 'f-2', title: 'F2', spec: '', criteriaIds: [], status: 'pending', milestoneId: 'm-1', attempts: 0 },
        { id: 'f-3', title: 'F3', spec: '', criteriaIds: [], status: 'pending', milestoneId: 'm-2', attempts: 0 },
      ],
      contract: { version: 1, criteria: [], createdAt: '', updatedAt: '' },
      strategy: 'Test strategy',
      estimatedRuns: 7, // 3 features + 2 * 2 milestones
    }
    expect(plan.estimatedRuns).toBe(plan.features.length + 2 * plan.milestones.length)
  })

  it('Mission has orchestrator and worker model fields', () => {
    const mission: Mission = {
      id: 'test-1',
      goal: 'Build a login system',
      cwd: '/tmp/test',
      orchestratorModel: 'claude-opus-4',
      workerModel: 'claude-sonnet-4',
      state: {
        phase: 'planning',
        currentMilestoneIndex: 0,
        featuresImplemented: 0,
        featuresValidated: 0,
        featuresFailed: 0,
        totalRuns: 0,
        totalTokens: 0,
        startedAt: new Date().toISOString(),
      },
      maxFeatureRetries: 3,
      maxMilestoneRetries: 2,
    }
    expect(mission.orchestratorModel).toBe('claude-opus-4')
    expect(mission.workerModel).toBe('claude-sonnet-4')
  })

  it('MissionEvent carries type, timestamp, and message', () => {
    const event: MissionEvent = {
      type: 'feature_completed',
      timestamp: new Date().toISOString(),
      entityId: 'f-1',
      message: 'Feature completed: Add login endpoint',
      data: { attempts: 1 },
    }
    expect(event.type).toBe('feature_completed')
    expect(event.entityId).toBe('f-1')
  })

  it('FeatureStatus type covers full lifecycle', () => {
    const statuses: FeatureStatus[] = ['pending', 'in_progress', 'implemented', 'validated', 'failed']
    expect(statuses).toHaveLength(5)
  })

  it('MilestoneStatus type covers full lifecycle', () => {
    const statuses: MilestoneStatus[] = ['pending', 'in_progress', 'validating', 'passed', 'failed']
    expect(statuses).toHaveLength(5)
  })

  it('MissionPhase type covers all phases', () => {
    const phases: MissionPhase[] = ['planning', 'executing', 'validating', 'retrying', 'completed', 'failed', 'aborted']
    expect(phases).toHaveLength(7)
  })
})

// ── Controller ──────────────────────────────────────────────────

// Mock chatOnce and spawnSubAgent to test controller logic without real API calls
vi.mock('../src/providers/openai-compat.js', () => ({
  chatOnce: vi.fn(),
}))

vi.mock('../src/agent/sub-agent.js', () => ({
  spawnSubAgent: vi.fn(),
  DELEGATE_TOOLS: ['read_file', 'write_file', 'run_command'],
  READ_ONLY_TOOLS: ['read_file'],
}))

import { MissionController } from '../src/mission/controller.js'
import { chatOnce } from '../src/providers/openai-compat.js'
import { spawnSubAgent } from '../src/agent/sub-agent.js'

const mockedChatOnce = vi.mocked(chatOnce)
const mockedSpawnSubAgent = vi.mocked(spawnSubAgent)

describe('MissionController', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `orca-mission-test-${randomUUID().slice(0, 8)}`)
    mkdirSync(tmpDir, { recursive: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  const apiOptions = {
    apiKey: 'test-key',
    baseURL: 'http://localhost:8080/v1',
    model: 'test-model',
  }

  describe('constructor', () => {
    it('creates mission with initial state', () => {
      const ctrl = new MissionController('build a thing', tmpDir, apiOptions)
      const state = ctrl.getState()

      expect(state.id).toBeTruthy()
      expect(state.goal).toBe('build a thing')
      expect(state.cwd).toBe(tmpDir)
      expect(state.state.phase).toBe('planning')
      expect(state.state.totalRuns).toBe(0)
    })

    it('creates .orca/missions directory', () => {
      const ctrl = new MissionController('test', tmpDir, apiOptions)
      const missionDir = join(tmpDir, '.orca', 'missions', ctrl.getState().id)
      expect(existsSync(missionDir)).toBe(true)
    })

    it('accepts custom worker model', () => {
      const ctrl = new MissionController('test', tmpDir, apiOptions, {
        workerModel: 'gpt-5',
      })
      expect(ctrl.getState().workerModel).toBe('gpt-5')
    })
  })

  describe('plan()', () => {
    it('calls chatOnce with orchestrator prompt', async () => {
      // Return a structured plan response
      mockedChatOnce.mockResolvedValueOnce({
        text: `Strategy: build incrementally.

\`\`\`contract
{
  "version": 1,
  "criteria": [
    { "id": "c-1", "description": "index.ts exists", "type": "file_exists", "value": "src/index.ts", "milestoneId": "m-1" }
  ],
  "createdAt": "2026-01-01",
  "updatedAt": "2026-01-01"
}
\`\`\`

\`\`\`milestones
[
  { "title": "Core setup", "featureIds": ["f-1"] }
]
\`\`\`

\`\`\`features
[
  { "title": "Create entry point", "spec": "Create src/index.ts with basic exports", "criteriaIds": ["c-1"], "milestoneId": "m-1", "files": ["src/index.ts"] }
]
\`\`\``,
        inputTokens: 500,
        outputTokens: 300,
      })

      const ctrl = new MissionController('setup project', tmpDir, apiOptions)
      const plan = await ctrl.plan()

      expect(mockedChatOnce).toHaveBeenCalledOnce()
      expect(plan.milestones).toHaveLength(1)
      expect(plan.features).toHaveLength(1)
      expect(plan.contract.criteria).toHaveLength(1)
      expect(plan.contract.criteria[0]!.type).toBe('file_exists')
      expect(plan.estimatedRuns).toBe(3) // 1 feature + 2 * 1 milestone
    })

    it('persists plan artifacts to disk', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: 'Strategy.\n```milestones\n[{"title":"M1"}]\n```\n```features\n[{"title":"F1","spec":"do it"}]\n```',
        inputTokens: 100,
        outputTokens: 100,
      })

      const ctrl = new MissionController('test persist', tmpDir, apiOptions)
      await ctrl.plan()

      const missionDir = join(tmpDir, '.orca', 'missions', ctrl.getState().id)
      expect(existsSync(join(missionDir, 'plan.json'))).toBe(true)
      expect(existsSync(join(missionDir, 'validation-contract.json'))).toBe(true)
      expect(existsSync(join(missionDir, 'state.json'))).toBe(true)
    })

    it('emits plan_created event', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: '- feature one\n- feature two',
        inputTokens: 50,
        outputTokens: 50,
      })

      const events: MissionEvent[] = []
      const ctrl = new MissionController('test events', tmpDir, apiOptions)
      ctrl.onEvent(e => events.push(e))

      await ctrl.plan()

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('plan_created')
    })

    it('falls back to bullet extraction when JSON blocks missing', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: 'Here is the plan:\n- Create user model\n- Add auth middleware\n- Write tests',
        inputTokens: 50,
        outputTokens: 50,
      })

      const ctrl = new MissionController('fallback plan', tmpDir, apiOptions)
      const plan = await ctrl.plan()

      // Fallback creates features from bullet points
      expect(plan.features.length).toBeGreaterThanOrEqual(3)
      expect(plan.milestones).toHaveLength(1)
      expect(plan.milestones[0]!.title).toBe('Complete all features')
    })

    it('tracks token usage', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: '- do something',
        inputTokens: 1000,
        outputTokens: 500,
      })

      const ctrl = new MissionController('token tracking', tmpDir, apiOptions)
      await ctrl.plan()

      expect(ctrl.getState().state.totalTokens).toBe(1500)
    })
  })

  describe('execute()', () => {
    it('throws if plan() not called first', async () => {
      const ctrl = new MissionController('no plan', tmpDir, apiOptions)
      await expect(ctrl.execute()).rejects.toThrow('Must call plan() before execute()')
    })

    it('implements features and validates milestone', async () => {
      // Plan response
      mockedChatOnce.mockResolvedValueOnce({
        text: `\`\`\`contract
{"version":1,"criteria":[{"id":"c-1","description":"file exists","type":"file_exists","value":"output.txt","milestoneId":"m-1"}],"createdAt":"","updatedAt":""}
\`\`\`
\`\`\`milestones
[{"title":"Create output","featureIds":["f-1"]}]
\`\`\`
\`\`\`features
[{"title":"Write output file","spec":"Create output.txt","criteriaIds":["c-1"],"milestoneId":"m-1","files":["output.txt"]}]
\`\`\``,
        inputTokens: 200,
        outputTokens: 200,
      })

      // Worker succeeds and creates the file
      mockedSpawnSubAgent.mockImplementationOnce(async (config) => {
        // Simulate worker creating the file
        writeFileSync(join(tmpDir, 'output.txt'), 'hello', 'utf-8')
        return { success: true, output: 'Created output.txt', tokensUsed: 300, duration: 5000 }
      })

      const events: MissionEvent[] = []
      const ctrl = new MissionController('create file', tmpDir, apiOptions)
      ctrl.onEvent(e => events.push(e))

      await ctrl.plan()
      const state = await ctrl.execute()

      expect(state.phase).toBe('completed')
      expect(state.featuresImplemented).toBe(1)
      expect(state.featuresValidated).toBe(1)
      expect(state.totalRuns).toBe(1)

      // Check events
      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain('plan_created')
      expect(eventTypes).toContain('milestone_started')
      expect(eventTypes).toContain('feature_started')
      expect(eventTypes).toContain('feature_completed')
      expect(eventTypes).toContain('validation_passed')
      expect(eventTypes).toContain('milestone_passed')
      expect(eventTypes).toContain('mission_completed')
    })

    it('retries failed features with feedback', async () => {
      // Plan with a command-type criterion
      mockedChatOnce.mockResolvedValueOnce({
        text: `\`\`\`contract
{"version":1,"criteria":[{"id":"c-1","description":"exit 0","type":"command","value":"test -f ${join(tmpDir, 'result.txt')}","milestoneId":"m-1"}],"createdAt":"","updatedAt":""}
\`\`\`
\`\`\`milestones
[{"title":"Produce result","featureIds":["f-1"]}]
\`\`\`
\`\`\`features
[{"title":"Create result","spec":"Make result.txt","criteriaIds":["c-1"],"milestoneId":"m-1"}]
\`\`\``,
        inputTokens: 100,
        outputTokens: 100,
      })

      // First attempt fails (doesn't create file)
      mockedSpawnSubAgent.mockResolvedValueOnce({
        success: true, output: 'Tried but failed', tokensUsed: 100, duration: 2000,
      })
      // Retry attempt succeeds
      mockedSpawnSubAgent.mockImplementationOnce(async () => {
        writeFileSync(join(tmpDir, 'result.txt'), 'done', 'utf-8')
        return { success: true, output: 'Created result.txt', tokensUsed: 150, duration: 3000 }
      })

      const ctrl = new MissionController('retry test', tmpDir, apiOptions)
      await ctrl.plan()
      const state = await ctrl.execute()

      expect(state.phase).toBe('completed')
      // Worker called twice: first attempt + retry
      expect(mockedSpawnSubAgent).toHaveBeenCalledTimes(2)
    })

    it('fails mission when milestone exceeds max retries', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: `\`\`\`contract
{"version":1,"criteria":[{"id":"c-1","description":"impossible","type":"command","value":"false","milestoneId":"m-1"}],"createdAt":"","updatedAt":""}
\`\`\`
\`\`\`milestones
[{"title":"Impossible","featureIds":["f-1"]}]
\`\`\`
\`\`\`features
[{"title":"Do impossible","spec":"Cannot succeed","criteriaIds":["c-1"],"milestoneId":"m-1"}]
\`\`\``,
        inputTokens: 100,
        outputTokens: 100,
      })

      // All attempts "succeed" but criterion never passes (command: "false")
      mockedSpawnSubAgent.mockResolvedValue({
        success: true, output: 'Tried', tokensUsed: 50, duration: 1000,
      })

      const events: MissionEvent[] = []
      const ctrl = new MissionController('fail test', tmpDir, apiOptions, {
        maxMilestoneRetries: 1,
        maxFeatureRetries: 2,
      })
      ctrl.onEvent(e => events.push(e))

      await ctrl.plan()
      const state = await ctrl.execute()

      expect(state.phase).toBe('failed')
      expect(state.error).toContain('Impossible')

      const eventTypes = events.map(e => e.type)
      expect(eventTypes).toContain('milestone_failed')
      expect(eventTypes).toContain('mission_failed')
    })
  })

  describe('abort()', () => {
    it('sets phase to aborted and emits event', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: '- step one',
        inputTokens: 10,
        outputTokens: 10,
      })

      const events: MissionEvent[] = []
      const ctrl = new MissionController('abort test', tmpDir, apiOptions)
      ctrl.onEvent(e => events.push(e))

      await ctrl.plan()
      ctrl.abort()

      expect(ctrl.getState().state.phase).toBe('aborted')
      expect(ctrl.getState().state.completedAt).toBeTruthy()
      expect(events.some(e => e.type === 'mission_aborted')).toBe(true)
    })
  })

  describe('getSummary()', () => {
    it('returns formatted summary string', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: '- feature A\n- feature B',
        inputTokens: 50,
        outputTokens: 50,
      })

      const ctrl = new MissionController('summary test', tmpDir, apiOptions)
      await ctrl.plan()

      const summary = ctrl.getSummary()
      expect(summary).toContain('Mission:')
      expect(summary).toContain('Goal: summary test')
      expect(summary).toContain('Phase: planning')
      expect(summary).toContain('Tokens:')
    })
  })

  describe('onEvent()', () => {
    it('supports multiple event handlers', async () => {
      mockedChatOnce.mockResolvedValueOnce({
        text: '- one thing',
        inputTokens: 10,
        outputTokens: 10,
      })

      const events1: MissionEvent[] = []
      const events2: MissionEvent[] = []

      const ctrl = new MissionController('multi handler', tmpDir, apiOptions)
      ctrl.onEvent(e => events1.push(e))
      ctrl.onEvent(e => events2.push(e))

      await ctrl.plan()

      expect(events1).toHaveLength(1)
      expect(events2).toHaveLength(1)
      expect(events1[0]!.type).toBe('plan_created')
    })
  })
})
