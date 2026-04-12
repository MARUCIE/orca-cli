/**
 * Platform-aware sandbox execution.
 *
 * Dispatches to macOS Seatbelt or Linux bwrap based on process.platform.
 * Falls back to direct exec on unsupported platforms with a warning.
 */

import { execSync } from 'node:child_process'
import { logWarning } from '../logger.js'
import type { SandboxPolicy } from './seatbelt.js'
import { executeSeatbelted } from './seatbelt.js'
import { executeBwrapped } from './bwrap.js'

export type { SandboxPolicy } from './seatbelt.js'
export { generateSeatbeltProfile, executeSeatbelted } from './seatbelt.js'
export { buildBwrapCommand, executeBwrapped } from './bwrap.js'

/** Execute a command in the platform-appropriate sandbox. */
export function executeSandboxed(
  command: string,
  policy: SandboxPolicy,
  cwd: string,
): { success: boolean; output: string; exitCode: number } {
  switch (process.platform) {
    case 'darwin':
      return executeSeatbelted(command, policy, cwd)
    case 'linux':
      return executeBwrapped(command, policy, cwd)
    default:
      logWarning(`No sandbox available for platform "${process.platform}", running unsandboxed`)
      return execDirect(command, cwd)
  }
}

// ── Fallback ─────────────────────────────────────────────────────

function execDirect(command: string, cwd: string): { success: boolean; output: string; exitCode: number } {
  try {
    const output = execSync(`sh -c "${command.replace(/"/g, '\\"')}"`, {
      cwd,
      encoding: 'utf-8',
      timeout: 60_000,
    }).trim()
    return { success: true, output, exitCode: 0 }
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; message?: string }
    return {
      success: false,
      output: e.stderr ?? e.message ?? String(err),
      exitCode: e.status ?? 1,
    }
  }
}
