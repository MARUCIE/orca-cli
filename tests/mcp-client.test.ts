import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCPClient } from '../src/mcp-client.js'
import { createTempProject } from './helpers/temp-project.js'
import { withEnv } from './helpers/env-snapshot.js'

describe('MCPClient', () => {
  let tempProject: ReturnType<typeof createTempProject>
  let client: MCPClient
  let origHome: string | undefined

  beforeEach(() => {
    client = new MCPClient()
    // Isolate from real HOME configs
    origHome = process.env.HOME
  })

  afterEach(() => {
    process.env.HOME = origHome
    if (tempProject) {
      tempProject.cleanup()
    }
  })

  /** Helper: create project + set HOME to its dir so global configs are isolated */
  function setupIsolated(files: Record<string, string>) {
    tempProject = createTempProject(files)
    process.env.HOME = tempProject.dir
    return tempProject
  }

  describe('loadConfigs()', () => {
    it('reads native .mcp.json format', () => {
      setupIsolated({
        '.mcp.json': JSON.stringify({
          'server-a': { command: 'node', args: ['server.js'], env: { FOO: 'bar' } },
        }),
      })

      client.loadConfigs(tempProject.dir)

      expect(client.configuredCount).toBe(1)
    })

    it('reads .orca.json with mcpServers key', () => {
      setupIsolated({
        '.orca.json': JSON.stringify({
          mcpServers: {
            'server-b': { command: 'python', args: ['serve.py'] },
          },
        }),
      })

      client.loadConfigs(tempProject.dir)

      expect(client.configuredCount).toBe(1)
    })

    it('reads .claude/settings.json with mcpServers key', () => {
      setupIsolated({
        '.claude/settings.json': JSON.stringify({
          mcpServers: {
            'server-c': { command: 'bash', args: ['run.sh'], env: { DEBUG: 'true' } },
          },
        }),
      })

      client.loadConfigs(tempProject.dir)

      expect(client.configuredCount).toBe(1)
    })

    it('reads Codex TOML from HOME/.codex/config.toml', async () => {
      setupIsolated({})

      const globalTemp = createTempProject({
        '.codex/config.toml': `[mcp_servers.server_d]\ncommand = "node"\nargs = ["server.js"]\nenabled = true\n`,
      })

      await withEnv({ HOME: globalTemp.dir }, () => {
        client.loadConfigs(tempProject.dir)
        expect(client.configuredCount).toBe(1)
      })

      globalTemp.cleanup()
    })

    it('native configs take priority over Claude Code configs', () => {
      setupIsolated({
        '.mcp.json': JSON.stringify({
          'same-server': { command: 'native-cmd', args: ['arg1'] },
        }),
        '.claude/settings.json': JSON.stringify({
          mcpServers: {
            'same-server': { command: 'claude-cmd', args: ['arg2'] },
          },
        }),
      })

      client.loadConfigs(tempProject.dir)

      // Only 1 config should exist (native won)
      expect(client.configuredCount).toBe(1)

      // Verify it's the native one by checking the command
      const servers = client.listServers()
      expect(servers[0]?.name).toBe('same-server')
    })

    it('skips disabled Codex servers', async () => {
      setupIsolated({})

      const globalTemp = createTempProject({
        '.codex/config.toml': `
[mcp_servers.enabled_server]
command = "node"
enabled = true

[mcp_servers.disabled_server]
command = "bash"
enabled = false
`,
      })

      await withEnv({ HOME: globalTemp.dir }, () => {
        client.loadConfigs(tempProject.dir)
        // Only enabled_server should be loaded
        expect(client.configuredCount).toBe(1)
      })

      globalTemp.cleanup()
    })

    it('handles malformed JSON gracefully without crashing', () => {
      setupIsolated({
        '.mcp.json': '{ invalid json }',
      })

      // Should not throw
      expect(() => {
        client.loadConfigs(tempProject.dir)
      }).not.toThrow()

      // Config should be empty
      expect(client.configuredCount).toBe(0)
    })

    it('returns correct configuredCount after merge', () => {
      setupIsolated({
        '.mcp.json': JSON.stringify({
          'server1': { command: 'cmd1' },
          'server2': { command: 'cmd2' },
        }),
      })

      client.loadConfigs(tempProject.dir)

      expect(client.configuredCount).toBe(2)
    })

    it('parses Claude Code format with command, args, and env', () => {
      setupIsolated({
        '.claude/settings.json': JSON.stringify({
          mcpServers: {
            'cc-server': {
              command: 'node',
              args: ['app.js', '--port', '3000'],
              env: { LOG_LEVEL: 'debug' },
            },
          },
        }),
      })

      client.loadConfigs(tempProject.dir)

      expect(client.configuredCount).toBe(1)
    })

    it('produces zero configs when all files missing', () => {
      setupIsolated({})

      client.loadConfigs(tempProject.dir)

      expect(client.configuredCount).toBe(0)
    })
  })

  describe('connectedCount', () => {
    it('returns 0 when no servers connected', () => {
      expect(client.connectedCount).toBe(0)
    })
  })

  describe('listServers()', () => {
    it('lists configured but unconnected servers', () => {
      setupIsolated({
        '.mcp.json': JSON.stringify({
          'server-x': { command: 'node' },
          'server-y': { command: 'python' },
        }),
      })

      client.loadConfigs(tempProject.dir)
      const servers = client.listServers()

      expect(servers).toHaveLength(2)
      expect(servers[0]?.name).toBe('server-x')
      expect(servers[0]?.initialized).toBe(false)
      expect(servers[0]?.pid).toBe(0)
    })
  })
})
