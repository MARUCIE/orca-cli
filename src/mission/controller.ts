/**
 * MissionController — orchestrates multi-step autonomous task execution.
 *
 * Lifecycle:
 *   1. plan()     — Orchestrator decomposes goal into validation contract + milestones + features
 *   2. execute()  — For each milestone, workers implement features, validators verify
 *   3. Retry loop — Failed features get re-queued with feedback from validator
 *   4. Complete   — All milestones pass, or mission fails/aborts
 *
 * Design decisions:
 *   - Workers get fresh context (via spawnSubAgent) to prevent context rot
 *   - Validators are independent: they check against the contract, not the implementation
 *   - State is persisted to disk as JSON so any agent can read it without shared memory
 *   - Events are emitted for real-time progress display in the REPL
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

import { chatOnce } from '../providers/openai-compat.js'
import type { OpenAICompatOptions } from '../providers/openai-compat.js'
import { spawnSubAgent, DELEGATE_TOOLS, READ_ONLY_TOOLS } from '../agent/sub-agent.js'
import type { SubAgentResult } from '../agent/sub-agent.js'

import type {
  Mission, MissionPlan, MissionState, MissionPhase,
  Milestone, Feature, ValidationContract, AcceptanceCriterion,
  MissionEvent, MissionEventHandler, MissionEventType,
  FeatureStatus,
} from './types.js'

// ── Constants ───────────────────────────────────────────────────

const MISSION_DIR = '.orca/missions'
const MAX_FEATURE_RETRIES = 3
const MAX_MILESTONE_RETRIES = 2
const WORKER_TIMEOUT = 120_000   // 2 min per feature
const VALIDATOR_TIMEOUT = 60_000 // 1 min per validation

// ── MissionController ───────────────────────────────────────────

export class MissionController {
  private mission: Mission
  private apiOptions: OpenAICompatOptions
  private eventHandlers: MissionEventHandler[] = []
  private missionDir: string

  constructor(
    goal: string,
    cwd: string,
    apiOptions: OpenAICompatOptions,
    options?: {
      workerModel?: string
      maxFeatureRetries?: number
      maxMilestoneRetries?: number
    },
  ) {
    const id = randomUUID().slice(0, 8)
    this.apiOptions = apiOptions
    this.missionDir = join(cwd, MISSION_DIR, id)

    this.mission = {
      id,
      goal,
      cwd,
      orchestratorModel: apiOptions.model,
      workerModel: options?.workerModel || apiOptions.model,
      state: createInitialState(),
      maxFeatureRetries: options?.maxFeatureRetries ?? MAX_FEATURE_RETRIES,
      maxMilestoneRetries: options?.maxMilestoneRetries ?? MAX_MILESTONE_RETRIES,
    }

    mkdirSync(this.missionDir, { recursive: true })
  }

  /** Subscribe to mission progress events */
  onEvent(handler: MissionEventHandler): void {
    this.eventHandlers.push(handler)
  }

  /** Get current mission state */
  getState(): Readonly<Mission> {
    return this.mission
  }

  /**
   * Phase 1: Plan the mission.
   *
   * Orchestrator produces:
   *   1. ValidationContract — acceptance criteria (FIRST)
   *   2. Milestones — ordered validation gates
   *   3. Features — atomic work units assigned to milestones
   */
  async plan(): Promise<MissionPlan> {
    this.setPhase('planning')

    const planPrompt = buildPlanPrompt(this.mission.goal, this.mission.cwd)

    const result = await chatOnce(
      { ...this.apiOptions, systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT },
      planPrompt,
    )

    this.mission.state.totalTokens += result.inputTokens + result.outputTokens

    const plan = parsePlanResponse(result.text, this.mission.id)
    this.mission.plan = plan

    // Persist contract and plan to disk
    this.writeArtifact('validation-contract.json', JSON.stringify(plan.contract, null, 2))
    this.writeArtifact('plan.json', JSON.stringify(plan, null, 2))
    this.persistState()

    this.emit('plan_created', undefined,
      `Plan: ${plan.milestones.length} milestones, ${plan.features.length} features, ~${plan.estimatedRuns} runs`,
      { milestones: plan.milestones.length, features: plan.features.length },
    )

    return plan
  }

  /**
   * Phase 2: Execute the mission.
   *
   * For each milestone:
   *   1. Implement all pending features (workers)
   *   2. Validate milestone (validator)
   *   3. On failure: re-queue failed features with feedback
   *   4. Repeat until milestone passes or max retries hit
   */
  async execute(): Promise<MissionState> {
    if (!this.mission.plan) {
      throw new Error('Must call plan() before execute()')
    }

    this.setPhase('executing')

    for (let mi = 0; mi < this.mission.plan.milestones.length; mi++) {
      this.mission.state.currentMilestoneIndex = mi
      const milestone = this.mission.plan.milestones[mi]!

      this.emit('milestone_started', milestone.id, `Milestone ${mi + 1}: ${milestone.title}`)
      milestone.status = 'in_progress'

      const passed = await this.executeMilestone(milestone)

      if (!passed) {
        milestone.status = 'failed'
        this.emit('milestone_failed', milestone.id, `Milestone failed after ${milestone.validationAttempts} attempts: ${milestone.title}`)
        this.setPhase('failed')
        this.mission.state.error = `Milestone "${milestone.title}" failed after max retries`
        this.persistState()
        this.emit('mission_failed', undefined,
          `Mission failed: ${this.mission.state.error}`,
          { featuresImplemented: this.mission.state.featuresImplemented },
        )
        return this.mission.state
      }

      milestone.status = 'passed'
      this.emit('milestone_passed', milestone.id, `Milestone passed: ${milestone.title}`)
    }

    this.setPhase('completed')
    this.mission.state.completedAt = new Date().toISOString()
    this.persistState()

    this.emit('mission_completed', undefined,
      `Mission completed: ${this.mission.state.featuresImplemented} features, ${this.mission.state.totalRuns} runs`,
    )

    return this.mission.state
  }

  /** Abort the mission */
  abort(): void {
    this.setPhase('aborted')
    this.mission.state.completedAt = new Date().toISOString()
    this.persistState()
    this.emit('mission_aborted', undefined, 'Mission aborted by user')
  }

  /** Get mission summary for display */
  getSummary(): string {
    const s = this.mission.state
    const plan = this.mission.plan

    const lines = [
      `Mission: ${this.mission.id}`,
      `Goal: ${this.mission.goal}`,
      `Phase: ${s.phase}`,
      `Progress: ${s.featuresValidated}/${plan?.features.length ?? '?'} features validated`,
      `Runs: ${s.totalRuns} (est: ${plan?.estimatedRuns ?? '?'})`,
      `Tokens: ${s.totalTokens.toLocaleString()}`,
    ]

    if (s.featuresFailed > 0) {
      lines.push(`Failed: ${s.featuresFailed} features`)
    }

    if (s.startedAt) {
      const elapsed = Date.now() - new Date(s.startedAt).getTime()
      const mins = Math.floor(elapsed / 60_000)
      const secs = Math.floor((elapsed % 60_000) / 1000)
      lines.push(`Elapsed: ${mins}m ${secs}s`)
    }

    return lines.join('\n')
  }

  // ── Private: Milestone Execution ────────────────────────────────

  private async executeMilestone(milestone: Milestone): Promise<boolean> {
    const plan = this.mission.plan!

    for (let attempt = 0; attempt <= milestone.maxRetries; attempt++) {
      milestone.validationAttempts = attempt + 1

      // Implement all pending/failed features
      const features = milestone.featureIds
        .map(id => plan.features.find(f => f.id === id)!)
        .filter(f => f.status === 'pending' || f.status === 'failed')

      for (const feature of features) {
        await this.implementFeature(feature)
      }

      // Validate milestone
      milestone.status = 'validating'
      this.emit('validation_started', milestone.id, `Validating milestone: ${milestone.title}`)

      const validationResult = await this.validateMilestone(milestone)

      if (validationResult.passed) {
        this.emit('validation_passed', milestone.id, `Milestone validated: ${milestone.title}`)
        return true
      }

      // Mark failed features from validation feedback
      this.emit('validation_failed', milestone.id,
        `Validation failed (attempt ${attempt + 1}/${milestone.maxRetries + 1}): ${validationResult.feedback}`,
      )

      if (attempt < milestone.maxRetries) {
        this.setPhase('retrying')
        // Mark features whose criteria failed as 'failed' for re-implementation
        for (const failedCriterionId of validationResult.failedCriteria) {
          const feature = plan.features.find(f => f.criteriaIds.includes(failedCriterionId))
          if (feature && feature.attempts < this.mission.maxFeatureRetries) {
            feature.status = 'failed'
            feature.lastOutput = validationResult.feedback
          }
        }
        this.setPhase('executing')
      }

      this.persistState()
    }

    return false
  }

  // ── Private: Feature Implementation ─────────────────────────────

  private async implementFeature(feature: Feature): Promise<void> {
    feature.status = 'in_progress'
    feature.attempts++
    this.mission.state.totalRuns++

    this.emit('feature_started', feature.id,
      `Implementing (attempt ${feature.attempts}): ${feature.title}`,
    )

    const workerPrompt = buildWorkerPrompt(feature, this.mission.plan!.contract)

    const result: SubAgentResult = await spawnSubAgent(
      {
        task: workerPrompt,
        model: this.mission.workerModel,
        tools: DELEGATE_TOOLS,
        timeout: WORKER_TIMEOUT,
        maxTurns: 15,
        cwd: this.mission.cwd,
      },
      {
        model: this.mission.workerModel,
        apiKey: this.apiOptions.apiKey,
        baseURL: this.apiOptions.baseURL,
      },
    )

    this.mission.state.totalTokens += result.tokensUsed

    if (result.success) {
      feature.status = 'implemented'
      feature.lastOutput = result.output.slice(0, 500)
      this.mission.state.featuresImplemented++
      this.emit('feature_completed', feature.id, `Implemented: ${feature.title}`)
    } else {
      feature.status = 'failed'
      feature.lastOutput = result.output.slice(0, 500)
      this.emit('feature_failed', feature.id, `Failed: ${feature.title} — ${result.output.slice(0, 200)}`)

      if (feature.attempts >= this.mission.maxFeatureRetries) {
        this.mission.state.featuresFailed++
      }
    }

    this.persistState()
  }

  // ── Private: Milestone Validation ───────────────────────────────

  private async validateMilestone(
    milestone: Milestone,
  ): Promise<{ passed: boolean; feedback: string; failedCriteria: string[] }> {
    const plan = this.mission.plan!
    const criteria = plan.contract.criteria.filter(c => c.milestoneId === milestone.id)

    const failedCriteria: string[] = []
    const feedbackParts: string[] = []

    for (const criterion of criteria) {
      const result = evaluateCriterion(criterion, this.mission.cwd)

      if (!result.passed) {
        failedCriteria.push(criterion.id)
        feedbackParts.push(`FAIL [${criterion.id}]: ${criterion.description} — ${result.detail}`)
      }
    }

    const passed = failedCriteria.length === 0

    if (passed) {
      // Mark all milestone features as validated
      for (const fid of milestone.featureIds) {
        const feature = plan.features.find(f => f.id === fid)
        if (feature) {
          feature.status = 'validated'
          this.mission.state.featuresValidated++
        }
      }
    }

    return {
      passed,
      feedback: passed ? 'All criteria passed' : feedbackParts.join('\n'),
      failedCriteria,
    }
  }

  // ── Private: Helpers ────────────────────────────────────────────

  private setPhase(phase: MissionPhase): void {
    this.mission.state.phase = phase
  }

  private emit(
    type: MissionEventType,
    entityId: string | undefined,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const event: MissionEvent = {
      type,
      timestamp: new Date().toISOString(),
      entityId,
      message,
      data,
    }
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }

  private writeArtifact(filename: string, content: string): void {
    writeFileSync(join(this.missionDir, filename), content, 'utf-8')
  }

  private persistState(): void {
    this.writeArtifact('state.json', JSON.stringify({
      mission: this.mission,
    }, null, 2))
  }
}

// ── Criterion Evaluation (independent of implementation) ────────

function evaluateCriterion(
  criterion: AcceptanceCriterion,
  cwd: string,
): { passed: boolean; detail: string } {
  switch (criterion.type) {
    case 'command': {
      try {
        const output = execSync(criterion.value, {
          cwd,
          encoding: 'utf-8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        return { passed: true, detail: output.trim().slice(0, 200) }
      } catch (err) {
        const e = err as { stderr?: string; stdout?: string; status?: number }
        return { passed: false, detail: `Exit ${e.status ?? '?'}: ${(e.stderr || e.stdout || '').trim().slice(0, 200)}` }
      }
    }

    case 'regex': {
      // Read the target file or run a command and match regex
      // For now, check recent git diff for the pattern
      try {
        const diff = execSync('git diff HEAD~1 --unified=0', { cwd, encoding: 'utf-8', timeout: 10_000 })
        const regex = new RegExp(criterion.value, 'i')
        const matched = regex.test(diff)
        return { passed: matched, detail: matched ? 'Pattern found in recent changes' : 'Pattern not found' }
      } catch {
        return { passed: false, detail: 'Could not read git diff for regex check' }
      }
    }

    case 'file_exists': {
      const fullPath = join(cwd, criterion.value)
      const exists = existsSync(fullPath)
      return { passed: exists, detail: exists ? 'File exists' : `File not found: ${criterion.value}` }
    }
  }
}

// ── Plan Parsing ────────────────────────────────────────────────

/**
 * Parse the orchestrator's plan response into structured MissionPlan.
 *
 * The orchestrator is prompted to output JSON-fenced blocks:
 *   ```contract { ... }```
 *   ```milestones [ ... ]```
 *   ```features [ ... ]```
 *
 * Falls back to heuristic extraction if structured output fails.
 */
function parsePlanResponse(text: string, missionId: string): MissionPlan {
  const contract = extractJsonBlock<ValidationContract>(text, 'contract') || buildDefaultContract(missionId)
  const rawMilestones = extractJsonBlock<Array<{ title: string; featureIds?: string[] }>>(text, 'milestones') || []
  const rawFeatures = extractJsonBlock<Array<{
    title: string; spec: string; criteriaIds?: string[];
    milestoneId?: string; files?: string[]
  }>>(text, 'features') || []

  // If structured extraction failed, try to parse from plain text
  if (rawMilestones.length === 0 && rawFeatures.length === 0) {
    return buildFallbackPlan(text, missionId, contract)
  }

  // Build features with IDs
  const features: Feature[] = rawFeatures.map((rf, i) => ({
    id: `f-${i + 1}`,
    title: rf.title,
    spec: rf.spec,
    criteriaIds: rf.criteriaIds || [],
    status: 'pending' as FeatureStatus,
    milestoneId: rf.milestoneId || rawMilestones[0]?.title ? `m-1` : 'default',
    attempts: 0,
    files: rf.files,
  }))

  // Build milestones
  const milestones: Milestone[] = rawMilestones.map((rm, i) => ({
    id: `m-${i + 1}`,
    title: rm.title,
    featureIds: rm.featureIds || features.filter(f => f.milestoneId === `m-${i + 1}`).map(f => f.id),
    status: 'pending',
    validationAttempts: 0,
    maxRetries: MAX_MILESTONE_RETRIES,
  }))

  // Ensure every feature belongs to a milestone
  const assignedFeatures = new Set(milestones.flatMap(m => m.featureIds))
  const orphans = features.filter(f => !assignedFeatures.has(f.id))
  if (orphans.length > 0 && milestones.length > 0) {
    // Assign orphans to last milestone
    const lastMs = milestones[milestones.length - 1]!
    for (const orphan of orphans) {
      lastMs.featureIds.push(orphan.id)
      orphan.milestoneId = lastMs.id
    }
  }

  // Update contract criteria milestoneIds
  for (const criterion of contract.criteria) {
    if (!criterion.milestoneId && milestones.length > 0) {
      criterion.milestoneId = milestones[0]!.id
    }
  }

  const estimatedRuns = features.length + 2 * milestones.length

  // Extract strategy text (everything before the first ```block)
  const strategyMatch = text.match(/^([\s\S]*?)```/)
  const strategy = strategyMatch?.[1]?.trim() || text.slice(0, 500)

  return { milestones, features, contract, strategy, estimatedRuns }
}

/** Extract a JSON block fenced as ```label ... ``` */
function extractJsonBlock<T>(text: string, label: string): T | null {
  // Try ```label\n{...}\n``` format
  const regex = new RegExp('```' + label + '\\s*\\n([\\s\\S]*?)\\n```', 'i')
  const match = text.match(regex)
  if (match?.[1]) {
    try { return JSON.parse(match[1]) as T } catch { /* fall through */ }
  }

  // Try ```json\n// label\n{...}\n``` format
  const jsonRegex = /```json\s*\n([\s\S]*?)\n```/gi
  let jsonMatch: RegExpExecArray | null
  while ((jsonMatch = jsonRegex.exec(text)) !== null) {
    const block = jsonMatch[1]!
    if (block.toLowerCase().includes(label)) {
      try {
        // Strip comment lines
        const cleaned = block.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
        return JSON.parse(cleaned) as T
      } catch { /* continue */ }
    }
  }

  return null
}

/** Build a default contract when the orchestrator doesn't produce structured output */
function buildDefaultContract(missionId: string): ValidationContract {
  return {
    version: 1,
    criteria: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** Build a plan from unstructured text when JSON extraction fails */
function buildFallbackPlan(text: string, missionId: string, contract: ValidationContract): MissionPlan {
  // Extract bullet points as features
  const bullets = text.match(/^[\s]*[-*]\s+(.+)/gm) || []
  const features: Feature[] = bullets.slice(0, 20).map((b, i) => ({
    id: `f-${i + 1}`,
    title: b.replace(/^[\s]*[-*]\s+/, '').trim().slice(0, 100),
    spec: b.replace(/^[\s]*[-*]\s+/, '').trim(),
    criteriaIds: [],
    status: 'pending' as FeatureStatus,
    milestoneId: 'm-1',
    attempts: 0,
  }))

  // Single milestone containing all features
  const milestones: Milestone[] = [{
    id: 'm-1',
    title: 'Complete all features',
    featureIds: features.map(f => f.id),
    status: 'pending',
    validationAttempts: 0,
    maxRetries: MAX_MILESTONE_RETRIES,
  }]

  return {
    milestones,
    features,
    contract,
    strategy: text.slice(0, 500),
    estimatedRuns: features.length + 2,
  }
}

// ── Prompt Templates ────────────────────────────────────────────

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a mission orchestrator. Your job is to decompose a user's goal into a structured execution plan.

CRITICAL: Write the validation contract FIRST, before decomposing features.
The validation contract defines what "done" looks like — acceptance criteria that an independent validator will check.

Output format — use these fenced blocks:

\`\`\`contract
{
  "version": 1,
  "criteria": [
    { "id": "c-1", "description": "...", "type": "command|regex|file_exists", "value": "...", "milestoneId": "m-1" }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
\`\`\`

\`\`\`milestones
[
  { "title": "Milestone name", "featureIds": ["f-1", "f-2"] }
]
\`\`\`

\`\`\`features
[
  { "title": "Feature name", "spec": "Detailed spec...", "criteriaIds": ["c-1"], "milestoneId": "m-1", "files": ["src/foo.ts"] }
]
\`\`\`

Rules:
- Validation criteria must be mechanically verifiable (commands, file existence, regex on output)
- Each feature should be implementable in a single focused session (~15 tool calls)
- Order milestones so earlier ones provide foundations for later ones
- Include "files" arrays so workers know their scope
- Keep specs detailed enough that a worker with no prior context can implement them`

function buildPlanPrompt(goal: string, cwd: string): string {
  // Gather project context for the orchestrator
  let projectContext = ''
  try {
    const files = execSync('find . -maxdepth 3 -name "*.ts" -o -name "*.js" -o -name "*.json" -o -name "*.md" | head -50', {
      cwd, encoding: 'utf-8', timeout: 5_000,
    }).trim()
    projectContext = `\nProject files:\n${files}`
  } catch { /* no context available */ }

  let packageInfo = ''
  try {
    const pkg = readFileSync(join(cwd, 'package.json'), 'utf-8')
    const parsed = JSON.parse(pkg) as { name?: string; scripts?: Record<string, string> }
    packageInfo = `\nPackage: ${parsed.name || 'unknown'}\nScripts: ${Object.keys(parsed.scripts || {}).join(', ')}`
  } catch { /* no package.json */ }

  return `Decompose this goal into a mission plan.

Goal: ${goal}

Working directory: ${cwd}
${projectContext}
${packageInfo}

Remember: Write the validation contract FIRST (what "done" looks like), then decompose into milestones and features.`
}

function buildWorkerPrompt(feature: Feature, contract: ValidationContract): string {
  const relevantCriteria = contract.criteria
    .filter(c => feature.criteriaIds.includes(c.id))
    .map(c => `  - [${c.id}] ${c.description} (${c.type}: ${c.value})`)
    .join('\n')

  const retryContext = feature.lastOutput
    ? `\n\nPrevious attempt failed:\n${feature.lastOutput}\n\nFix the issues and try again.`
    : ''

  return `Implement this feature:

Title: ${feature.title}
Spec: ${feature.spec}
${feature.files?.length ? `Files to modify: ${feature.files.join(', ')}` : ''}

Acceptance criteria:
${relevantCriteria || '  (no specific criteria — use your best judgment)'}
${retryContext}

Rules:
- Focus only on this feature, do not modify unrelated code
- Write tests if the project has a test framework
- Commit your changes when done`
}

// ── State Factory ───────────────────────────────────────────────

function createInitialState(): MissionState {
  return {
    phase: 'planning',
    currentMilestoneIndex: 0,
    featuresImplemented: 0,
    featuresValidated: 0,
    featuresFailed: 0,
    totalRuns: 0,
    totalTokens: 0,
    startedAt: new Date().toISOString(),
  }
}
