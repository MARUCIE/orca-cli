/**
 * Orca doctor diagnostics.
 *
 * Hermes-inspired local diagnostics:
 * - config + provider readiness
 * - hook / MCP discovery
 * - sessions / background jobs / logs presence
 * - project context summary
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { HookManager } from './hooks.js'
import { MCPClient } from './mcp-client.js'
import { loadProjectContext } from './context.js'
import { getOrcaHome, getLogPath } from './logger.js'
import { listBackgroundJobs } from './background-jobs.js'
import { getGlobalConfigPath, listProviders, resolveConfig, resolveProvider } from './config.js'
import { gatherConfigDiagnostics, type ConfigDiagnostic } from './config-diagnostics.js'

export interface DoctorReport {
  cwd: string
  nodeVersion: string
  proxy: string | null
  project: {
    type: string
    name: string
    framework: string | null
    testRunner: string | null
    configFiles: string[]
  }
  provider: {
    activeProvider: string | null
    model: string | null
    hasApiKey: boolean
    hasBaseURL: boolean
    disabled: boolean
    warning?: string
  }
  providersConfigured: number
  hooksConfigured: number
  mcpConfigured: number
  sessionsSaved: number
  backgroundJobs: {
    total: number
    running: number
  }
  logs: {
    agentPath: string
    errorPath: string
    agentExists: boolean
    errorExists: boolean
  }
  configPaths: {
    global: string
    project: string
    projectExists: boolean
  }
  configDiagnostics: ConfigDiagnostic[]
  git: {
    available: boolean
    branch: string | null
  }
}

export function gatherDoctorReport(cwdInput: string): DoctorReport {
  const cwd = resolve(cwdInput)
  const config = resolveConfig({ cwd })
  const ctx = loadProjectContext(cwd)
  const hookManager = new HookManager()
  hookManager.load(cwd)
  const mcpClient = new MCPClient()
  mcpClient.loadConfigs(cwd)

  const orcaHome = getOrcaHome()
  const sessionsDir = join(orcaHome, 'sessions')
  const backgroundJobs = listBackgroundJobs(200)
  const configDiagnostics = gatherConfigDiagnostics(cwd)

  let activeProvider: string | null = null
  let model: string | null = null
  let hasApiKey = false
  let hasBaseURL = false
  let disabled = false
  let warning: string | undefined

  try {
    const resolved = resolveProvider(config)
    activeProvider = resolved.provider
    model = resolved.model
    hasApiKey = Boolean(resolved.apiKey)
    hasBaseURL = Boolean(resolved.baseURL)
    disabled = Boolean(config.providers[resolved.provider]?.disabled)
    if (disabled) {
      warning = `resolved provider "${resolved.provider}" is marked disabled in config`
    }
  } catch (err) {
    warning = err instanceof Error ? err.message : String(err)
  }

  let gitAvailable = false
  let branch: string | null = null
  try {
    execSync('git --version', { stdio: 'pipe' })
    gitAvailable = true
    try {
      branch = execSync('git branch --show-current', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null
    } catch { /* not a repo */ }
  } catch { /* git missing */ }

  const sessionCount = existsSync(sessionsDir)
    ? readdirSync(sessionsDir).filter((name) => name.endsWith('.json')).length
    : 0

  const runningJobs = backgroundJobs.filter((job) => job.status === 'running').length

  return {
    cwd,
    nodeVersion: process.version,
    proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null,
    project: {
      type: ctx.type,
      name: ctx.name,
      framework: ctx.framework,
      testRunner: ctx.testRunner,
      configFiles: ctx.configFiles,
    },
    provider: {
      activeProvider,
      model,
      hasApiKey,
      hasBaseURL,
      disabled,
      warning,
    },
    providersConfigured: listProviders(config).length,
    hooksConfigured: hookManager.totalHooks,
    mcpConfigured: mcpClient.configuredCount,
    sessionsSaved: sessionCount,
    backgroundJobs: {
      total: backgroundJobs.length,
      running: runningJobs,
    },
    logs: {
      agentPath: getLogPath('agent'),
      errorPath: getLogPath('errors'),
      agentExists: existsSync(getLogPath('agent')),
      errorExists: existsSync(getLogPath('errors')),
    },
    configPaths: {
      global: getGlobalConfigPath(),
      project: join(cwd, '.orca.json'),
      projectExists: existsSync(join(cwd, '.orca.json')),
    },
    configDiagnostics,
    git: {
      available: gitAvailable,
      branch,
    },
  }
}
