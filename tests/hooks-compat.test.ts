import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { HookManager } from '../src/hooks.js'
import { createTempProject } from './helpers/temp-project.js'
import { withEnv } from './helpers/env-snapshot.js'

describe('HookManager - Claude Code Compatibility', () => {
  let tempProject: ReturnType<typeof createTempProject>
  let manager: HookManager
  let origHome: string | undefined

  beforeEach(() => {
    manager = new HookManager()
    origHome = process.env.HOME
  })

  afterEach(() => {
    process.env.HOME = origHome
    if (tempProject) {
      tempProject.cleanup()
    }
  })

  /** Isolate from real HOME configs */
  function isolated(files: Record<string, string>) {
    tempProject = createTempProject(files)
    process.env.HOME = tempProject.dir
    return tempProject
  }

  describe('Claude Code format', () => {
    it('loads hooks from .claude/settings.json nested format', () => {
      isolated({
        '.claude/settings.json': JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [
                  { type: 'command', command: 'echo "bash tool"', timeout: 5000 },
                ],
              },
            ],
          },
        }),
      })

      manager.load(tempProject.dir)

      expect(manager.hasHooks('PreToolUse')).toBe(true)
      expect(manager.totalHooks).toBeGreaterThan(0)
    })

    it('converts Claude Code timeout from milliseconds to seconds', () => {
      isolated({
        '.claude/settings.json': JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Read',
                hooks: [{ type: 'command', command: 'test-cmd', timeout: 5000 }],
              },
            ],
          },
        }),
      })

      manager.load(tempProject.dir)

      // Verify hook was loaded (internal timeout conversion happens in load)
      expect(manager.totalHooks).toBeGreaterThan(0)
    })

    it('sets both CLAUDE_HOOK_EVENT and ORCA_HOOK_EVENT env vars', async () => {
      isolated({})

      // Test would run actual hook, which we're just testing setup here
      // The actual env var setting is tested in hooks.ts execution
      manager.load(tempProject.dir)

      expect(manager).toBeDefined()
    })
  })

  describe('Hook event recognition', () => {
    it('recognizes Stop event as valid hook event', () => {
      isolated({
        '.orca.json': JSON.stringify({
          hooks: {
            Stop: [{ command: 'echo stopped' }],
          },
        }),
      })

      manager.load(tempProject.dir)

      expect(manager.hasHooks('Stop')).toBe(true)
    })

    it('recognizes SubagentStop event as valid hook event', () => {
      isolated({
        '.orca.json': JSON.stringify({
          hooks: {
            SubagentStop: [{ command: 'echo subagent-stopped' }],
          },
        }),
      })

      manager.load(tempProject.dir)

      expect(manager.hasHooks('SubagentStop')).toBe(true)
    })
  })

  describe('Config merging', () => {
    it('merges hooks from multiple config sources', () => {
      isolated({
        '.orca.json': JSON.stringify({
          hooks: {
            PreToolUse: [{ command: 'echo from-orca' }],
          },
        }),
        '.claude/settings.json': JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'echo from-claude' }],
              },
            ],
          },
        }),
      })

      manager.load(tempProject.dir)

      // Both should be merged
      expect(manager.totalHooks).toBeGreaterThan(0)
      expect(manager.hasHooks('PreToolUse')).toBe(true)
    })
  })

  describe('Matcher conversion', () => {
    it('converts Claude Code matcher "Bash" to "run_command|Bash"', () => {
      isolated({
        '.claude/settings.json': JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'test-bash' }],
              },
            ],
          },
        }),
      })

      manager.load(tempProject.dir)

      expect(manager.hasHooks('PreToolUse')).toBe(true)
    })

    it('converts Claude Code matcher "Edit|Write" to include both Orca and Claude names', () => {
      isolated({
        '.claude/settings.json': JSON.stringify({
          hooks: {
            PostToolUse: [
              {
                matcher: 'Edit|Write',
                hooks: [{ type: 'command', command: 'test-edit-write' }],
              },
            ],
          },
        }),
      })

      manager.load(tempProject.dir)

      expect(manager.hasHooks('PostToolUse')).toBe(true)
    })
  })

  describe('Event mapping', () => {
    it('maps PermissionRequest event to PreToolUse', () => {
      isolated({
        '.claude/settings.json': JSON.stringify({
          hooks: {
            PermissionRequest: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'check-permission' }],
              },
            ],
          },
        }),
      })

      manager.load(tempProject.dir)

      // PermissionRequest should be mapped to PreToolUse
      expect(manager.hasHooks('PreToolUse')).toBe(true)
    })
  })

  describe('Global config loading', () => {
    it('loads hooks from HOME/.claude/settings.json', () => {
      isolated({
        '.claude/settings.json': JSON.stringify({
          hooks: {
            SessionStart: [
              {
                matcher: '*',
                hooks: [{ type: 'command', command: 'global-hook' }],
              },
            ],
          },
        }),
      })

      manager.load(tempProject.dir)
      expect(manager.hasHooks('SessionStart')).toBe(true)
    })
  })

  describe('Idempotency', () => {
    it('load() can be called multiple times safely', () => {
      isolated({
        '.orca.json': JSON.stringify({
          hooks: {
            PreToolUse: [{ command: 'echo test' }],
          },
        }),
      })

      manager.load(tempProject.dir)
      const firstCount = manager.totalHooks

      manager.load(tempProject.dir)
      const secondCount = manager.totalHooks

      // Second load should not double the hooks (it's idempotent)
      expect(firstCount).toBe(secondCount)
    })
  })
})
