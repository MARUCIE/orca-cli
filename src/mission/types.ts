/**
 * Mission Mode — type definitions.
 *
 * Models the Droid-inspired multi-step autonomous execution:
 *   Mission → MissionPlan → Milestones → Features
 *
 * Key invariant: ValidationContract is defined BEFORE features are
 * decomposed, preventing implementation bias in acceptance criteria.
 */

// ── Validation Contract ─────────────────────────────────────────

/** A single acceptance criterion in the validation contract. */
export interface AcceptanceCriterion {
  id: string
  /** Human-readable description of what must be true */
  description: string
  /** How to verify: 'command' runs a shell command, 'regex' matches output, 'file_exists' checks path */
  type: 'command' | 'regex' | 'file_exists'
  /** The command, regex pattern, or file path to check */
  value: string
  /** Which milestone this criterion belongs to */
  milestoneId: string
}

/**
 * Validation Contract — the source of truth for mission success.
 * Written FIRST by the orchestrator, BEFORE feature decomposition.
 * Validators check features against this contract, not against
 * the implementation itself (prevents self-evaluation bias).
 */
export interface ValidationContract {
  /** Contract version (bumped on amendment) */
  version: number
  /** All acceptance criteria, grouped by milestone */
  criteria: AcceptanceCriterion[]
  /** When the contract was created */
  createdAt: string
  /** When last amended */
  updatedAt: string
}

// ── Features & Milestones ───────────────────────────────────────

export type FeatureStatus = 'pending' | 'in_progress' | 'implemented' | 'validated' | 'failed'

/** A single feature — the unit of work assigned to one worker. */
export interface Feature {
  id: string
  /** Short imperative title: "Add user login endpoint" */
  title: string
  /** Detailed spec the worker receives as its task prompt */
  spec: string
  /** IDs of acceptance criteria this feature must satisfy */
  criteriaIds: string[]
  /** Current status */
  status: FeatureStatus
  /** Which milestone this feature belongs to */
  milestoneId: string
  /** Number of implementation attempts */
  attempts: number
  /** Last worker output (for debugging / retry context) */
  lastOutput?: string
  /** Files this feature is expected to touch (for conflict detection) */
  files?: string[]
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'validating' | 'passed' | 'failed'

/**
 * Milestone — a validation gate grouping related features.
 * All features in a milestone must pass before the milestone
 * itself passes. Failed features get re-queued with feedback.
 */
export interface Milestone {
  id: string
  /** Short title: "Core API endpoints" */
  title: string
  /** Ordered feature IDs */
  featureIds: string[]
  /** Current status */
  status: MilestoneStatus
  /** Validation attempts on this milestone */
  validationAttempts: number
  /** Max validation retries before marking milestone as failed */
  maxRetries: number
}

// ── Mission Plan ────────────────────────────────────────────────

/**
 * MissionPlan — the full decomposition produced by the orchestrator.
 * Contains the validation contract, milestones, and features.
 */
export interface MissionPlan {
  /** Ordered milestones (executed sequentially) */
  milestones: Milestone[]
  /** All features (referenced by milestones) */
  features: Feature[]
  /** The validation contract (source of truth) */
  contract: ValidationContract
  /** Orchestrator's high-level strategy notes */
  strategy: string
  /** Estimated total cost: features + 2 * milestones */
  estimatedRuns: number
}

// ── Mission State ───────────────────────────────────────────────

export type MissionPhase =
  | 'planning'       // Orchestrator decomposing the goal
  | 'executing'      // Workers implementing features
  | 'validating'     // Validators checking milestone
  | 'retrying'       // Re-implementing failed features
  | 'completed'      // All milestones passed
  | 'failed'         // Unrecoverable failure
  | 'aborted'        // User cancelled

/**
 * MissionState — persistent state that survives across context windows.
 * Written to disk as JSON so any agent (orchestrator, worker, validator)
 * can read the current state without shared memory.
 */
export interface MissionState {
  /** Current phase */
  phase: MissionPhase
  /** Index of the current milestone being worked on */
  currentMilestoneIndex: number
  /** Total features implemented (including retries) */
  featuresImplemented: number
  /** Total features validated */
  featuresValidated: number
  /** Total features failed (after all retries) */
  featuresFailed: number
  /** Total worker runs consumed */
  totalRuns: number
  /** Total tokens consumed across all agents */
  totalTokens: number
  /** Start time (ISO string) */
  startedAt: string
  /** End time (ISO string, set on completion) */
  completedAt?: string
  /** Error message if failed */
  error?: string
}

// ── Mission (top-level) ─────────────────────────────────────────

/**
 * Mission — the top-level object representing a multi-step autonomous task.
 *
 * Lifecycle:
 *   1. User describes goal → orchestrator creates MissionPlan
 *   2. Orchestrator writes ValidationContract FIRST
 *   3. Orchestrator decomposes goal into Milestones → Features
 *   4. For each Milestone:
 *      a. Workers implement Features (fresh context each)
 *      b. Validators check Features against contract
 *      c. Failed features get re-queued with feedback
 *      d. Milestone passes when all criteria are met
 *   5. Mission completes when all milestones pass
 */
export interface Mission {
  /** Unique mission ID */
  id: string
  /** User's original goal description */
  goal: string
  /** Working directory */
  cwd: string
  /** Model to use for orchestrator */
  orchestratorModel: string
  /** Model(s) to use for workers (can differ from orchestrator) */
  workerModel: string
  /** The plan (populated after planning phase) */
  plan?: MissionPlan
  /** Current state */
  state: MissionState
  /** Max retries per feature before giving up */
  maxFeatureRetries: number
  /** Max retries per milestone validation */
  maxMilestoneRetries: number
}

// ── Events (for progress reporting) ─────────────────────────────

export type MissionEventType =
  | 'plan_created'
  | 'milestone_started'
  | 'feature_started'
  | 'feature_completed'
  | 'feature_failed'
  | 'validation_started'
  | 'validation_passed'
  | 'validation_failed'
  | 'milestone_passed'
  | 'milestone_failed'
  | 'mission_completed'
  | 'mission_failed'
  | 'mission_aborted'

export interface MissionEvent {
  type: MissionEventType
  timestamp: string
  /** Related entity ID (feature/milestone) */
  entityId?: string
  /** Human-readable message */
  message: string
  /** Additional data */
  data?: Record<string, unknown>
}

/** Callback for mission progress events */
export type MissionEventHandler = (event: MissionEvent) => void
