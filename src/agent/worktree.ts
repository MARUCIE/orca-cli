/**
 * Git Worktree Agent Teams.
 *
 * Manages isolated git worktrees for parallel agent tasks.
 * Each agent gets its own branch and working directory under
 * <repo>/.orca-worktrees/<id>.
 */

import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

export interface WorktreeAgent {
  id: string
  branch: string
  worktreePath: string
  task: string
  status: 'working' | 'done' | 'failed'
  createdAt: number
}

// ── Manager ──────────────────────────────────────────────────────

export class WorktreeManager {
  private agents = new Map<string, WorktreeAgent>()

  /** Create a new worktree for an agent task. */
  create(cwd: string, task: string, baseBranch?: string): WorktreeAgent {
    const id = randomUUID().slice(0, 8)
    const branch = `orca-agent-${id}`
    const worktreePath = join(cwd, '.orca-worktrees', id)
    const base = baseBranch ?? 'HEAD'

    try {
      execSync(`git worktree add -b ${branch} "${worktreePath}" ${base}`, {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch (err) {
      throw new Error(`Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`)
    }

    const agent: WorktreeAgent = {
      id,
      branch,
      worktreePath,
      task,
      status: 'working',
      createdAt: Date.now(),
    }
    this.agents.set(id, agent)
    return agent
  }

  /** Merge a completed agent's worktree back to the base branch. */
  merge(agentId: string, cwd: string): { success: boolean; output: string } {
    const agent = this.agents.get(agentId)
    if (!agent) {
      return { success: false, output: `Agent ${agentId} not found` }
    }

    try {
      const output = execSync(`git merge ${agent.branch}`, {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim()
      agent.status = 'done'
      return { success: true, output }
    } catch (err) {
      const output = err instanceof Error ? err.message : String(err)
      return { success: false, output }
    }
  }

  /** Clean up a worktree (remove the worktree and delete the branch). */
  cleanup(agentId: string, cwd: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return

    try {
      execSync(`git worktree remove "${agent.worktreePath}"`, {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch {
      // worktree may already be removed
    }

    try {
      execSync(`git branch -d ${agent.branch}`, {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
    } catch {
      // branch may already be deleted
    }

    this.agents.delete(agentId)
  }

  /** List all active agent worktrees. */
  list(): WorktreeAgent[] {
    return [...this.agents.values()]
  }

  /** Mark an agent as done or failed. */
  updateStatus(agentId: string, status: 'done' | 'failed'): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.status = status
    }
  }
}
