/**
 * Mission Mode — multi-step autonomous task execution.
 *
 * Inspired by Factory.ai Droid Missions architecture:
 *   - Orchestrator: plans, decomposes, steers
 *   - Workers: implement features with fresh context
 *   - Validators: independent verification against contract
 *
 * Key design principles:
 *   1. Validation contract FIRST, then features (prevents implementation bias)
 *   2. Each worker gets fresh context (prevents context rot)
 *   3. Validators are separate from implementers (prevents self-evaluation bias)
 *   4. Shared artifacts over shared context (state in files, not memory)
 *
 * Integration:
 *   /mission in REPL — interactive planning + execution
 *   orca run --mission — headless mission execution
 */

export { MissionController } from './controller.js'
export type {
  Mission, MissionPlan, Milestone, Feature, ValidationContract, MissionState,
  AcceptanceCriterion, MissionEvent, MissionEventHandler, MissionPhase,
  FeatureStatus, MilestoneStatus, MissionEventType,
} from './types.js'
