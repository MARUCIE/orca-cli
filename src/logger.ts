/**
 * Centralized runtime logging for Orca CLI.
 *
 * Hermes-inspired behavior:
 * - structured local logs under ~/.orca/logs or $ORCA_HOME/logs
 * - agent.log captures info/warn/error
 * - errors.log captures warn/error
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type OrcaLogLevel = 'info' | 'warn' | 'error'

export function getOrcaHome(): string {
  return process.env.ORCA_HOME || join(process.env.HOME || homedir(), '.orca')
}

export function getLogsDir(): string {
  const dir = join(getOrcaHome(), 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getLogPath(kind: 'agent' | 'errors'): string {
  return join(getLogsDir(), kind === 'agent' ? 'agent.log' : 'errors.log')
}

function serializeContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return ''
  try {
    return ` ${JSON.stringify(context)}`
  } catch {
    return ''
  }
}

export function writeLog(level: OrcaLogLevel, message: string, context?: Record<string, unknown>): void {
  try {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${serializeContext(context)}\n`
    appendFileSync(getLogPath('agent'), line, 'utf-8')
    if (level !== 'info') {
      appendFileSync(getLogPath('errors'), line, 'utf-8')
    }
  } catch {
    /* logging must never break the runtime */
  }
}

export function logInfo(message: string, context?: Record<string, unknown>): void {
  writeLog('info', message, context)
}

export function logWarning(message: string, context?: Record<string, unknown>): void {
  writeLog('warn', message, context)
}

export function logError(message: string, context?: Record<string, unknown>): void {
  writeLog('error', message, context)
}

export function readLogTail(kind: 'agent' | 'errors', lines = 50): string[] {
  const path = getLogPath(kind)
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, 'utf-8').trim()
    if (!content) return []
    return content.split('\n').slice(-Math.max(1, lines))
  } catch {
    return []
  }
}
