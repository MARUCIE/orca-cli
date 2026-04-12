/**
 * Sub-agent process isolation.
 *
 * Forks a child process that runs a simplified Orca agent loop
 * with a restricted tool set. The child makes a single API call
 * and returns the result via IPC.
 */

import { fork } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Public Types ─────────────────────────────────────────────

export interface SubAgentConfig {
  task: string
  model?: string         // default: inherit from parent
  tools?: string[]       // tool name whitelist (default: read-only tools)
  timeout?: number       // ms, default 60000
  cwd: string
}

export interface SubAgentResult {
  success: boolean
  output: string
  tokensUsed: number
  duration: number
}

/** IPC message sent from parent to worker. */
export interface WorkerRequest {
  type: 'start'
  task: string
  model: string
  apiKey: string
  baseURL: string
  systemPrompt: string
  tools: string[]
  cwd: string
}

/** IPC message sent from worker back to parent. */
export interface WorkerResponse {
  type: 'result'
  success: boolean
  output: string
  tokensUsed: number
}

// ── Read-only tool whitelist (safe for explore-type agents) ──

export const READ_ONLY_TOOLS = [
  'read_file',
  'search_files',
  'glob_files',
  'list_directory',
  'find_definition',
  'directory_tree',
  'count_lines',
  'git_status',
  'git_diff',
  'git_log',
]

// ── Delegate tool set (everything minus truly dangerous ones) ─

export const DELEGATE_TOOLS = [
  ...READ_ONLY_TOOLS,
  'write_file',
  'edit_file',
  'multi_edit',
  'run_command',
  'run_background',
  'check_port',
  'task_create',
  'task_update',
  'task_list',
  'create_plan',
  'verify_plan',
  'fetch_url',
]

// ── Main entry point ─────────────────────────────────────────

/**
 * Spawn a sub-agent in a child process with restricted tools.
 * Returns a promise that resolves when the sub-agent completes
 * or rejects on timeout / process error.
 */
export function spawnSubAgent(
  config: SubAgentConfig,
  parentContext: { model: string; apiKey: string; baseURL: string },
): Promise<SubAgentResult> {
  const timeout = config.timeout ?? 60_000
  const startTime = Date.now()

  return new Promise<SubAgentResult>((resolve, reject) => {
    // Resolve the worker script path relative to this file's compiled location
    const thisDir = dirname(fileURLToPath(import.meta.url))
    const workerPath = join(thisDir, 'sub-agent-worker.js')

    const child = fork(workerPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      cwd: config.cwd,
      env: { ...process.env },
    })

    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill('SIGTERM')
        resolve({
          success: false,
          output: `Sub-agent timed out after ${timeout}ms`,
          tokensUsed: 0,
          duration: Date.now() - startTime,
        })
      }
    }, timeout)

    // Collect stderr for diagnostics
    let stderrBuf = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString() })

    child.on('message', (msg: WorkerResponse) => {
      if (settled) return
      if (msg.type === 'result') {
        settled = true
        clearTimeout(timer)
        child.kill('SIGTERM')
        resolve({
          success: msg.success,
          output: msg.output,
          tokensUsed: msg.tokensUsed,
          duration: Date.now() - startTime,
        })
      }
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        success: false,
        output: `Sub-agent process error: ${err.message}`,
        tokensUsed: 0,
        duration: Date.now() - startTime,
      })
    })

    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const detail = stderrBuf ? `\n${stderrBuf.slice(0, 500)}` : ''
      resolve({
        success: false,
        output: `Sub-agent exited with code ${code ?? 'null'}${detail}`,
        tokensUsed: 0,
        duration: Date.now() - startTime,
      })
    })

    // Send the task to the worker
    const request: WorkerRequest = {
      type: 'start',
      task: config.task,
      model: config.model || parentContext.model,
      apiKey: parentContext.apiKey,
      baseURL: parentContext.baseURL,
      systemPrompt: `You are a focused sub-agent. Complete the following task concisely. Use tools when needed. Working directory: ${config.cwd}`,
      tools: config.tools || READ_ONLY_TOOLS,
      cwd: config.cwd,
    }

    child.send(request)
  })
}
