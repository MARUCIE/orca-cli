/**
 * Skill Execution Engine: runs skill groups according to their execution mode.
 *
 * Modes:
 * - sequential: skills run one-by-one in declared order
 * - pipeline: sequential + optional gate check at the end
 * - loop: run loopSkills repeatedly until gate passes (up to maxIterations)
 * - swarm: coreTier skills run in parallel
 */

import { execSync } from 'node:child_process'
import type { ExecutionMode, SkillGroup } from './registry.js'
import type { SkillRegistry } from './registry.js'

// ── Types ────────────────────────────────────────────────────────

export interface SkillExecutionResult {
  mode: ExecutionMode
  iterations?: number
  outputs: string[]
  gateResult?: { passed: boolean; output: string }
  duration: number
}

// ── Engine ───────────────────────────────────────────────────────

export class SkillEngine {
  constructor(private registry: SkillRegistry) {}

  /** Execute a skill group on the given input. */
  async execute(group: SkillGroup, input: string, cwd: string): Promise<SkillExecutionResult> {
    const start = Date.now()

    switch (group.execution.mode) {
      case 'sequential':
        return this.runSequential(group, input, start)
      case 'pipeline':
        return this.runPipeline(group, input, cwd, start)
      case 'loop':
        return this.runLoop(group, input, cwd, start)
      case 'swarm':
        return this.runSwarm(group, input, start)
      default:
        return this.runSequential(group, input, start)
    }
  }

  // ── Mode implementations ─────────────────────────────────────

  private runSequential(group: SkillGroup, input: string, start: number): SkillExecutionResult {
    const outputs = group.skills.map(skill => `[${skill}] Processed: ${input}`)
    return { mode: 'sequential', outputs, duration: Date.now() - start }
  }

  private runPipeline(group: SkillGroup, input: string, cwd: string, start: number): SkillExecutionResult {
    const outputs = group.skills.map(skill => `[${skill}] Processed: ${input}`)
    const gateResult = group.execution.gateCommand
      ? this.runGate(group.execution.gateCommand, cwd)
      : undefined
    return { mode: 'pipeline', outputs, gateResult, duration: Date.now() - start }
  }

  private runLoop(group: SkillGroup, input: string, cwd: string, start: number): SkillExecutionResult {
    const skills = group.execution.loopSkills ?? group.skills
    const max = group.execution.maxIterations ?? 3
    const allOutputs: string[] = []
    let iterations = 0
    let gateResult: { passed: boolean; output: string } | undefined

    for (let i = 0; i < max; i++) {
      iterations++
      const iterOutputs = skills.map(skill => `[${skill}] Processed: ${input}`)
      allOutputs.push(...iterOutputs)

      if (group.execution.gateCommand) {
        gateResult = this.runGate(group.execution.gateCommand, cwd)
        if (gateResult.passed) break
      } else {
        // no gate command means single pass
        break
      }
    }

    return { mode: 'loop', iterations, outputs: allOutputs, gateResult, duration: Date.now() - start }
  }

  private async runSwarm(group: SkillGroup, input: string, start: number): Promise<SkillExecutionResult> {
    const skills = group.execution.coreTier ?? group.skills
    const outputs = await Promise.all(
      skills.map(async (skill) => `[${skill}] Processed: ${input}`),
    )
    return { mode: 'swarm', outputs, duration: Date.now() - start }
  }

  // ── Gate execution ───────────────────────────────────────────

  private runGate(command: string, cwd: string): { passed: boolean; output: string } {
    try {
      const output = execSync(command, { cwd, encoding: 'utf-8', timeout: 30_000 }).trim()
      return { passed: true, output }
    } catch (err) {
      const output = err instanceof Error ? err.message : String(err)
      return { passed: false, output }
    }
  }
}
