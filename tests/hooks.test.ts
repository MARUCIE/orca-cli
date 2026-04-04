/**
 * Round 5: Hook System & Safety — 15 tests
 * SOTA Dimension D5: Permission blocking, hook lifecycle, env vars
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { HookManager, type HookEvent } from '../src/hooks.js'
import { DANGEROUS_TOOLS } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `forge-hooks-${Date.now()}`)

beforeAll(() => {
  mkdirSync(join(testDir, '.armature'), { recursive: true })
  mkdirSync(join(testDir, '.claude'), { recursive: true })
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Config Loading ──────────────────────────────────────────────

describe('Hook config loading', () => {
  it('5.1 loads hooks from .armature/hooks.json', () => {
    const dir = join(testDir, 'armature-hooks')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      PreToolUse: [{ command: 'echo ok', matcher: 'run_command' }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    expect(manager.hasHooks('PreToolUse')).toBe(true)
    expect(manager.totalHooks).toBe(1)
  })

  it('5.2 loads hooks from .armature.json (nested hooks key)', () => {
    const dir = join(testDir, 'armature-json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.armature.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ command: 'echo startup' }],
        SessionEnd: [{ command: 'echo shutdown' }],
      },
    }))

    const manager = new HookManager()
    manager.load(dir)
    expect(manager.hasHooks('SessionStart')).toBe(true)
    expect(manager.hasHooks('SessionEnd')).toBe(true)
    expect(manager.totalHooks).toBe(2)
  })

  it('5.3 loads hooks from .claude/hooks.json', () => {
    const dir = join(testDir, 'claude-hooks')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'hooks.json'), JSON.stringify({
      PostToolUse: [{ command: 'echo logged' }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    expect(manager.hasHooks('PostToolUse')).toBe(true)
    expect(manager.totalHooks).toBe(1)
  })
})

// ── Hook Execution ──────────────────────────────────────────────

describe('Hook execution', () => {
  it('5.4 PreToolUse receives tool name and input as JSON stdin', async () => {
    const dir = join(testDir, 'pre-tool-input')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    // Hook script reads stdin JSON and echoes the tool name from it
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      PreToolUse: [{
        command: 'cat | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({\'continue\':True,\'additionalContext\':d.get(\'toolName\',\'\')}))"',
        matcher: '.*',
      }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('PreToolUse', {
      event: 'PreToolUse',
      toolName: 'read_file',
      toolInput: { path: 'test.ts' },
      cwd: dir,
    })
    expect(result.continue).toBe(true)
    expect(result.additionalContext).toContain('read_file')
  })

  it('5.5 PreToolUse non-zero exit blocks tool execution', async () => {
    const dir = join(testDir, 'pre-tool-block')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      PreToolUse: [{
        command: 'echo "BLOCKED: dangerous operation" >&2 && exit 1',
        matcher: 'run_command',
      }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('PreToolUse', {
      event: 'PreToolUse',
      toolName: 'run_command',
      toolInput: { command: 'rm -rf /' },
      cwd: dir,
    })
    expect(result.continue).toBe(false)
    expect(result.decision).toBe('block')
    expect(result.stopReason).toContain('BLOCKED')
  })

  it('5.6 PostToolUse receives tool result', async () => {
    const dir = join(testDir, 'post-tool')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      PostToolUse: [{
        command: 'cat | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({\'continue\':True,\'additionalContext\':\'success=\'+str(d.get(\'toolSuccess\',\'\'))}))"',
        matcher: '.*',
      }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('PostToolUse', {
      event: 'PostToolUse',
      toolName: 'read_file',
      toolOutput: 'file content here',
      toolSuccess: true,
      cwd: dir,
    })
    expect(result.continue).toBe(true)
    expect(result.additionalContext).toContain('success=True')
  })

  it('5.7 SessionStart hook fires and returns context', async () => {
    const dir = join(testDir, 'session-start')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      SessionStart: [{ command: 'echo "Session initialized"' }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('SessionStart', {
      event: 'SessionStart',
      cwd: dir,
    })
    expect(result.continue).toBe(true)
    expect(result.additionalContext).toContain('Session initialized')
  })

  it('5.8 SessionEnd hook fires on clean exit', async () => {
    const dir = join(testDir, 'session-end')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      SessionEnd: [{ command: 'echo "Goodbye"' }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('SessionEnd', {
      event: 'SessionEnd',
      cwd: dir,
    })
    expect(result.continue).toBe(true)
    expect(result.additionalContext).toContain('Goodbye')
  })
})

// ── Hook Matching & Env Vars ────────────────────────────────────

describe('Hook matching and env vars', () => {
  it('5.9 Matcher regex filters tool-specific hooks', async () => {
    const dir = join(testDir, 'matcher')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      PreToolUse: [{
        command: 'echo "should not fire" && exit 1',
        matcher: 'delete_file',  // only matches delete_file
      }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    // Call with read_file — should NOT match delete_file matcher
    const result = await manager.run('PreToolUse', {
      event: 'PreToolUse',
      toolName: 'read_file',
      cwd: dir,
    })
    expect(result.continue).toBe(true)
    // decision should not be 'block' since hook didn't match
    expect(result.decision).not.toBe('block')
  })

  it('5.10 Env vars FORGE_HOOK_EVENT and FORGE_HOOK_TOOL are set', async () => {
    const dir = join(testDir, 'env-vars')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      PreToolUse: [{
        command: 'echo "$FORGE_HOOK_EVENT:$FORGE_HOOK_TOOL"',
        matcher: '.*',
      }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('PreToolUse', {
      event: 'PreToolUse',
      toolName: 'edit_file',
      cwd: dir,
    })
    expect(result.additionalContext).toContain('PreToolUse:edit_file')
  })

  it('5.11 No hooks configured returns continue: true', async () => {
    const dir = join(testDir, 'no-hooks')
    mkdirSync(dir, { recursive: true })

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('PreToolUse', {
      event: 'PreToolUse',
      toolName: 'read_file',
    })
    expect(result.continue).toBe(true)
    expect(manager.totalHooks).toBe(0)
  })

  it('5.12 Hook returning JSON result is parsed correctly', async () => {
    const dir = join(testDir, 'json-result')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify({
      UserPromptSubmit: [{
        command: 'echo \'{"continue": true, "systemMessage": "context injected"}\'',
      }],
    }))

    const manager = new HookManager()
    manager.load(dir)
    const result = await manager.run('UserPromptSubmit', {
      event: 'UserPromptSubmit',
      prompt: 'hello',
      cwd: dir,
    })
    expect(result.continue).toBe(true)
    expect(result.systemMessage).toBe('context injected')
  })
})

// ── Safety & Permission ─────────────────────────────────────────

describe('Safety system', () => {
  it('5.13 DANGEROUS_TOOLS has exactly 9 members', () => {
    expect(DANGEROUS_TOOLS.size).toBe(9)
  })

  it('5.14 DANGEROUS_TOOLS contains expected dangerous operations', () => {
    const expected = ['write_file', 'edit_file', 'delete_file', 'move_file',
      'run_command', 'run_background', 'git_commit', 'multi_edit', 'patch_file']
    for (const tool of expected) {
      expect(DANGEROUS_TOOLS.has(tool)).toBe(true)
    }
  })

  it('5.15 All 8 hook event types are recognized', () => {
    const events: HookEvent[] = [
      'PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd',
      'PreCompact', 'PostCompact', 'UserPromptSubmit', 'SubagentStart',
    ]
    // Create a config with all 8 events
    const dir = join(testDir, 'all-events')
    mkdirSync(join(dir, '.armature'), { recursive: true })
    const config: Record<string, unknown[]> = {}
    for (const e of events) {
      config[e] = [{ command: 'echo ok' }]
    }
    writeFileSync(join(dir, '.armature', 'hooks.json'), JSON.stringify(config))

    const manager = new HookManager()
    manager.load(dir)
    for (const e of events) {
      expect(manager.hasHooks(e)).toBe(true)
    }
    expect(manager.totalHooks).toBe(8)
  })
})
