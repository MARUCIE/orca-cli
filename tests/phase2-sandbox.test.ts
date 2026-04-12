/**
 * Phase 2: Sandbox — 12 tests
 *
 * Covers:
 *   1. generateSeatbeltProfile — valid profile syntax, policy variations
 *   2. buildBwrapCommand — valid command structure, policy variations
 *   3. executeSandboxed — platform dispatch, result structure
 */

import { describe, it, expect } from 'vitest'
import { generateSeatbeltProfile } from '../src/sandbox/seatbelt.js'
import { buildBwrapCommand } from '../src/sandbox/bwrap.js'
import { executeSandboxed } from '../src/sandbox/index.js'
import type { SandboxPolicy } from '../src/sandbox/seatbelt.js'
import { tmpdir } from 'node:os'

// ── Common policies ────────────────────────────────────────────────

const MINIMAL_POLICY: SandboxPolicy = {
  allowRead: [],
  allowWrite: [],
  allowNetwork: false,
  allowExec: [],
}

const FULL_POLICY: SandboxPolicy = {
  allowRead: ['/home/user/project', '/opt/tools'],
  allowWrite: ['/home/user/project/dist'],
  allowNetwork: true,
  allowExec: ['/usr/local/bin/node'],
}

const CWD = tmpdir()

// ── Seatbelt Profile ───────────────────────────────────────────────

describe('generateSeatbeltProfile: macOS sandbox profiles', () => {
  it('SB.1 minimal policy produces valid seatbelt syntax', () => {
    const profile = generateSeatbeltProfile(MINIMAL_POLICY)
    expect(profile).toContain('(version 1)')
    expect(profile).toContain('(deny default)')
    // Should always allow basic exec paths
    expect(profile).toContain('/bin/sh')
    expect(profile).toContain('/usr/bin/env')
  })

  it('SB.2 network denied adds comment, not allow rule', () => {
    const profile = generateSeatbeltProfile(MINIMAL_POLICY)
    expect(profile).toContain(';; network denied')
    expect(profile).not.toContain('(allow network*)')
  })

  it('SB.3 network allowed adds allow network rule', () => {
    const profile = generateSeatbeltProfile({ ...MINIMAL_POLICY, allowNetwork: true })
    expect(profile).toContain('(allow network*)')
    expect(profile).not.toContain(';; network denied')
  })

  it('SB.4 allowRead paths appear as file-read subpaths', () => {
    const profile = generateSeatbeltProfile(FULL_POLICY)
    expect(profile).toContain('(subpath "/home/user/project")')
    expect(profile).toContain('(subpath "/opt/tools")')
  })

  it('SB.5 allowWrite paths appear as file-write subpaths', () => {
    const profile = generateSeatbeltProfile(FULL_POLICY)
    expect(profile).toContain('(allow file-write*')
    expect(profile).toContain('(subpath "/home/user/project/dist")')
  })

  it('SB.6 no allowWrite means no file-write rule', () => {
    const profile = generateSeatbeltProfile(MINIMAL_POLICY)
    expect(profile).not.toContain('(allow file-write*')
  })

  it('SB.7 allowExec paths appear in process-exec', () => {
    const profile = generateSeatbeltProfile(FULL_POLICY)
    expect(profile).toContain('(literal "/usr/local/bin/node")')
  })
})

// ── Bwrap Command ──────────────────────────────────────────────────

describe('buildBwrapCommand: Linux bwrap commands', () => {
  it('SB.8 minimal policy produces valid bwrap command', () => {
    const cmd = buildBwrapCommand('echo hello', MINIMAL_POLICY, '/tmp/sandbox')
    expect(cmd).toContain('bwrap')
    expect(cmd).toContain('--ro-bind /usr /usr')
    expect(cmd).toContain('--bind /tmp/sandbox /tmp/sandbox')
    expect(cmd).toContain('--die-with-parent')
    expect(cmd).toContain('echo hello')
  })

  it('SB.9 network isolation adds --unshare-net', () => {
    const cmd = buildBwrapCommand('ls', MINIMAL_POLICY, '/tmp')
    expect(cmd).toContain('--unshare-net')
  })

  it('SB.10 network allowed omits --unshare-net', () => {
    const cmd = buildBwrapCommand('ls', { ...MINIMAL_POLICY, allowNetwork: true }, '/tmp')
    expect(cmd).not.toContain('--unshare-net')
  })

  it('SB.11 extra writable paths become --bind entries', () => {
    const cmd = buildBwrapCommand('ls', FULL_POLICY, '/tmp/work')
    expect(cmd).toContain('--bind /home/user/project/dist /home/user/project/dist')
  })
})

// ── executeSandboxed ───────────────────────────────────────────────

describe('executeSandboxed: platform dispatch', () => {
  it('SB.12 executeSandboxed returns result with expected shape', () => {
    // On macOS: sandbox-exec may not be available in some CI environments
    // On Linux: bwrap may not be installed
    // On other platforms: falls back to direct execution
    // Either way, the function should return without throwing
    const result = executeSandboxed('echo sandboxed', MINIMAL_POLICY, CWD)
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('output')
    expect(result).toHaveProperty('exitCode')
    expect(typeof result.success).toBe('boolean')
    expect(typeof result.output).toBe('string')
    expect(typeof result.exitCode).toBe('number')
  })
})
