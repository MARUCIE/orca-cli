/**
 * Linux bubblewrap (bwrap) sandbox.
 *
 * Builds and executes bwrap command lines from a sandbox policy.
 * Only usable on Linux with bwrap installed.
 */

import { execSync } from 'node:child_process'
import type { SandboxPolicy } from './seatbelt.js'

// ── Command building ─────────────────────────────────────────────

/** Build a bwrap command line from a sandbox policy. */
export function buildBwrapCommand(command: string, policy: SandboxPolicy, cwd: string): string {
  const parts: string[] = ['bwrap']

  // base filesystem: read-only system paths
  parts.push('--ro-bind /usr /usr')
  parts.push('--ro-bind /lib /lib')

  // read-only mounts from policy
  for (const path of policy.allowRead) {
    parts.push(`--ro-bind ${path} ${path}`)
  }

  // writable cwd
  parts.push(`--bind ${cwd} ${cwd}`)

  // additional writable mounts
  for (const path of policy.allowWrite) {
    if (path !== cwd) {
      parts.push(`--bind ${path} ${path}`)
    }
  }

  // virtual filesystems
  parts.push('--dev /dev')
  parts.push('--proc /proc')

  // network isolation
  if (!policy.allowNetwork) {
    parts.push('--unshare-net')
  }

  // safety: die when parent exits
  parts.push('--die-with-parent')

  // the actual command
  parts.push(`-- sh -c "${command.replace(/"/g, '\\"')}"`)

  return parts.join(' ')
}

// ── Execution ────────────────────────────────────────────────────

/** Execute a command in a Linux bwrap sandbox. */
export function executeBwrapped(
  command: string,
  policy: SandboxPolicy,
  cwd: string,
): { success: boolean; output: string; exitCode: number } {
  const fullCommand = buildBwrapCommand(command, policy, cwd)
  try {
    const output = execSync(fullCommand, { cwd, encoding: 'utf-8', timeout: 60_000 }).trim()
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
