/**
 * Independent configuration diagnostics for Orca doctor.
 *
 * Purpose:
 * - inspect config files without mutating runtime behavior
 * - report malformed JSON explicitly instead of burying it in stderr
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getGlobalConfigPath } from './config.js'

export interface ConfigDiagnostic {
  kind: string
  path: string
  exists: boolean
  valid: boolean
  error?: string
}

function checkJsonFile(kind: string, path: string): ConfigDiagnostic {
  if (!existsSync(path)) {
    return { kind, path, exists: false, valid: true }
  }
  try {
    JSON.parse(readFileSync(path, 'utf-8'))
    return { kind, path, exists: true, valid: true }
  } catch (err) {
    return {
      kind,
      path,
      exists: true,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function gatherConfigDiagnostics(cwdInput: string): ConfigDiagnostic[] {
  const cwd = resolve(cwdInput)
  const home = process.env.HOME || '/tmp'

  return [
    checkJsonFile('global-config', getGlobalConfigPath()),
    checkJsonFile('project-config', join(cwd, '.orca.json')),
    checkJsonFile('project-mcp', join(cwd, '.mcp.json')),
    checkJsonFile('project-hooks', join(cwd, '.orca', 'hooks.json')),
    checkJsonFile('claude-settings', join(cwd, '.claude', 'settings.json')),
    checkJsonFile('global-mcp', join(home, '.orca', 'mcp.json')),
  ]
}
