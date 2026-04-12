/**
 * macOS Seatbelt sandbox profiles.
 *
 * Generates .sb profile strings and executes commands inside a
 * sandbox-exec jail. Only usable on Darwin.
 */

import { execSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Types ────────────────────────────────────────────────────────

export interface SandboxPolicy {
  allowRead: string[]
  allowWrite: string[]
  allowNetwork: boolean
  allowExec: string[]
}

// ── Profile generation ───────────────────────────────────────────

/** Generate a Seatbelt profile string (.sb format). */
export function generateSeatbeltProfile(policy: SandboxPolicy): string {
  const lines: string[] = [
    '(version 1)',
    '(deny default)',
  ]

  // exec rules — always allow /bin/sh and /usr/bin/env for command execution
  const execPaths = new Set(['/bin/sh', '/usr/bin/env', ...policy.allowExec])
  const execLiterals = [...execPaths].map(p => `(literal "${p}")`).join(' ')
  lines.push(`(allow process-exec ${execLiterals})`)

  // read rules — always include /usr and /System for basic operation
  const readPaths = new Set(['/usr', '/System', ...policy.allowRead])
  const readSubpaths = [...readPaths].map(p => `(subpath "${p}")`).join(' ')
  lines.push(`(allow file-read* ${readSubpaths})`)

  // write rules
  if (policy.allowWrite.length > 0) {
    const writeSubpaths = policy.allowWrite.map(p => `(subpath "${p}")`).join(' ')
    lines.push(`(allow file-write* ${writeSubpaths})`)
  }

  // network rules
  if (policy.allowNetwork) {
    lines.push('(allow network*)')
  } else {
    lines.push(';; network denied')
  }

  return lines.join('\n')
}

// ── Execution ────────────────────────────────────────────────────

/** Execute a command in a macOS sandbox. */
export function executeSeatbelted(
  command: string,
  policy: SandboxPolicy,
  cwd: string,
): { success: boolean; output: string; exitCode: number } {
  const profile = generateSeatbeltProfile({
    ...policy,
    allowRead: [...policy.allowRead, cwd],
    allowWrite: [...policy.allowWrite, cwd],
  })

  const profilePath = join(tmpdir(), `orca-sandbox-${Date.now()}.sb`)
  try {
    writeFileSync(profilePath, profile, 'utf-8')
    const output = execSync(
      `sandbox-exec -f "${profilePath}" -- sh -c "${command.replace(/"/g, '\\"')}"`,
      { cwd, encoding: 'utf-8', timeout: 60_000 },
    ).trim()
    return { success: true, output, exitCode: 0 }
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; message?: string }
    return {
      success: false,
      output: e.stderr ?? e.message ?? String(err),
      exitCode: e.status ?? 1,
    }
  } finally {
    try { unlinkSync(profilePath) } catch { /* best-effort cleanup */ }
  }
}
