/**
 * Round 24-25: v0.5.0 Module Tests
 *
 * Covers all 3 new modules:
 *   1. MCP Server (JSON-RPC 2.0 stdio transport) — 16 tests
 *   2. Mode Registry (behavioral profiles) — 14 tests
 *   3. AGENTS.md Auto-Discovery (hierarchical guidance) — 12 tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── 1. MCP Server ──────────────────────────────────────────────

import { MCPServer } from '../src/mcp-server.js'

describe('MCPServer: JSON-RPC 2.0 protocol', () => {
  let server: MCPServer

  beforeEach(() => {
    server = new MCPServer(process.cwd())
  })

  it('24.1 initialize returns server info + capabilities', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    })
    expect(res).not.toBeNull()
    expect(res!.id).toBe(1)
    expect(res!.result).toBeDefined()
    const result = res!.result as Record<string, unknown>
    expect(result.serverInfo).toEqual(
      expect.objectContaining({ name: 'orca-cli' }),
    )
    expect(result.capabilities).toBeDefined()
  })

  it('24.2 tools/list returns non-empty tool array with name/description/inputSchema', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    expect(res).not.toBeNull()
    const result = res!.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }
    expect(result.tools.length).toBeGreaterThan(0)
    for (const tool of result.tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    }
  })

  it('24.3 tools/call executes a real tool (read_file)', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'read_file',
        arguments: { path: 'package.json' },
      },
    })
    expect(res).not.toBeNull()
    const result = res!.result as { content: Array<{ type: string; text: string }>; isError: boolean }
    expect(result.isError).toBe(false)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('orca-cli')
  })

  it('24.4 tools/call with unknown tool returns isError=true', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'nonexistent_tool',
        arguments: {},
      },
    })
    expect(res).not.toBeNull()
    const result = res!.result as { content: Array<{ type: string; text: string }>; isError: boolean }
    expect(result.isError).toBe(true)
  })

  it('24.5 unknown method returns -32601 error', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'unknown/method',
    })
    expect(res).not.toBeNull()
    expect(res!.error).toBeDefined()
    expect(res!.error!.code).toBe(-32601)
    expect(res!.error!.message).toContain('unknown/method')
  })

  it('24.6 notification (no id) returns null — no response', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(res).toBeNull()
  })

  it('24.7 notification with id=null returns null', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: null,
      method: 'notifications/initialized',
    })
    expect(res).toBeNull()
  })

  it('24.8 response id matches request id', () => {
    const stringId = server.handleRequest({ jsonrpc: '2.0', id: 'abc-123', method: 'initialize' })
    expect(stringId!.id).toBe('abc-123')

    const numId = server.handleRequest({ jsonrpc: '2.0', id: 42, method: 'initialize' })
    expect(numId!.id).toBe(42)
  })

  it('24.9 tools/list tool count matches TOOL_DEFINITIONS', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/tools.js')
    const res = server.handleRequest({ jsonrpc: '2.0', id: 9, method: 'tools/list' })
    const result = res!.result as { tools: unknown[] }
    expect(result.tools.length).toBe(TOOL_DEFINITIONS.length)
  })

  it('24.10 tools/call with missing name returns error content', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { arguments: {} },
    })
    expect(res).not.toBeNull()
    const result = res!.result as { isError: boolean }
    expect(result.isError).toBe(true)
  })

  it('24.11 tools/call list_directory on cwd succeeds', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'list_directory',
        arguments: { path: '.' },
      },
    })
    const result = res!.result as { content: Array<{ text: string }>; isError: boolean }
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('src')
  })

  it('24.12 response always has jsonrpc 2.0', () => {
    const res = server.handleRequest({ jsonrpc: '2.0', id: 12, method: 'initialize' })
    expect(res!.jsonrpc).toBe('2.0')
  })

  it('24.13 constructor accepts cwd and tools/call respects it', () => {
    const tmpServer = new MCPServer('/tmp')
    const res = tmpServer.handleRequest({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'list_directory', arguments: { path: '.' } },
    })
    expect(res).not.toBeNull()
    // Should not throw — it uses /tmp as cwd
  })

  it('24.14 stop can be called safely even without start', () => {
    expect(() => server.stop()).not.toThrow()
  })

  it('24.15 stop can be called twice without error', () => {
    expect(() => {
      server.stop()
      server.stop()
    }).not.toThrow()
  })

  it('24.16 handleRequest with no params field on tools/call', () => {
    const res = server.handleRequest({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
    })
    expect(res).not.toBeNull()
    const result = res!.result as { isError: boolean }
    expect(result.isError).toBe(true)
  })
})

// ── 2. Mode Registry ──────────────────────────────────────────

import { ModeRegistry } from '../src/modes/index.js'
import type { Mode } from '../src/modes/index.js'

describe('ModeRegistry: behavioral profiles', () => {
  let registry: ModeRegistry

  beforeEach(() => {
    registry = new ModeRegistry()
  })

  it('25.1 has 5 builtin modes', () => {
    expect(registry.modeCount).toBe(5)
  })

  it('25.2 default mode is active on construction', () => {
    expect(registry.getActive().id).toBe('default')
  })

  it('25.3 default mode has empty systemPromptPrefix', () => {
    expect(registry.getActive().systemPromptPrefix).toBe('')
  })

  it('25.4 switchTo known mode returns true', () => {
    expect(registry.switchTo('debug')).toBe(true)
    expect(registry.getActive().id).toBe('debug')
  })

  it('25.5 switchTo unknown mode returns false', () => {
    expect(registry.switchTo('nonexistent')).toBe(false)
    expect(registry.getActive().id).toBe('default') // unchanged
  })

  it('25.6 code-review mode has restricted tool whitelist', () => {
    const mode = registry.getMode('code-review')!
    expect(mode.tools).toBeDefined()
    expect(mode.tools!.length).toBeGreaterThan(0)
    expect(mode.tools).toContain('read_file')
    // code-review should NOT have write tools
    expect(mode.tools).not.toContain('write_file')
    expect(mode.tools).not.toContain('run_command')
  })

  it('25.7 architect mode has restricted tool whitelist', () => {
    const mode = registry.getMode('architect')!
    expect(mode.tools).toBeDefined()
    expect(mode.tools).not.toContain('edit_file')
    expect(mode.tools).not.toContain('write_file')
  })

  it('25.8 listModes returns all modes', () => {
    const modes = registry.listModes()
    expect(modes.length).toBe(5)
    const ids = modes.map(m => m.id)
    expect(ids).toContain('default')
    expect(ids).toContain('code-review')
    expect(ids).toContain('debug')
    expect(ids).toContain('architect')
    expect(ids).toContain('docs')
  })

  it('25.9 getMode returns undefined for unknown id', () => {
    expect(registry.getMode('fake')).toBeUndefined()
  })

  it('25.10 loadFromFile adds custom modes', () => {
    const tmpDir = join(tmpdir(), `orca-modes-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const modesPath = join(tmpDir, 'modes.json')
    writeFileSync(modesPath, JSON.stringify([
      {
        id: 'security',
        name: 'Security Audit',
        description: 'Focus on security analysis',
        systemPromptPrefix: 'You are in security audit mode.',
        tools: ['read_file', 'search_files'],
      },
    ]))

    registry.loadFromFile(modesPath)
    expect(registry.modeCount).toBe(6)
    expect(registry.getMode('security')!.name).toBe('Security Audit')
    expect(registry.switchTo('security')).toBe(true)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('25.11 loadFromFile skips malformed entries', () => {
    const tmpDir = join(tmpdir(), `orca-modes-bad-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const modesPath = join(tmpDir, 'modes.json')
    writeFileSync(modesPath, JSON.stringify([
      { id: 'good', name: 'Good', systemPromptPrefix: 'ok' },
      { id: '', name: 'Bad No ID', systemPromptPrefix: 'nope' }, // empty id
      { name: 'No ID At All' }, // missing id
    ]))

    registry.loadFromFile(modesPath)
    expect(registry.getMode('good')).toBeDefined()
    // bad entries should be skipped
    expect(registry.modeCount).toBe(6)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('25.12 loadFromFile throws on non-array JSON', () => {
    const tmpDir = join(tmpdir(), `orca-modes-obj-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const modesPath = join(tmpDir, 'modes.json')
    writeFileSync(modesPath, '{"not":"array"}')

    expect(() => registry.loadFromFile(modesPath)).toThrow('Expected JSON array')

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('25.13 custom mode can override builtin mode', () => {
    const tmpDir = join(tmpdir(), `orca-modes-override-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const modesPath = join(tmpDir, 'modes.json')
    writeFileSync(modesPath, JSON.stringify([
      { id: 'debug', name: 'Custom Debug', description: 'Overridden', systemPromptPrefix: 'Custom debug mode.' },
    ]))

    registry.loadFromFile(modesPath)
    expect(registry.getMode('debug')!.name).toBe('Custom Debug')

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('25.14 debug mode has edit + run tools', () => {
    const mode = registry.getMode('debug')!
    expect(mode.tools).toContain('edit_file')
    expect(mode.tools).toContain('run_command')
  })
})

// ── 3. AGENTS.md Auto-Discovery ───────────────────────────────

import { discoverGuidance, formatGuidanceForPrompt } from '../src/agents-discovery.js'

describe('discoverGuidance: hierarchical file discovery', () => {
  const root = join(tmpdir(), `orca-discovery-${Date.now()}`)
  const child = join(root, 'sub', 'project')

  beforeAll(() => {
    mkdirSync(child, { recursive: true })

    // Root level
    writeFileSync(join(root, 'AGENTS.md'), '# Root Agents\nGlobal guidance.')
    writeFileSync(join(root, 'CLAUDE.md'), '# Root Claude\nGlobal rules.')

    // Sub level
    writeFileSync(join(root, 'sub', 'CODEX.md'), '# Mid Codex\nMiddle layer guidance.')

    // Project level
    writeFileSync(join(child, 'AGENTS.md'), '# Project Agents\nProject-specific.')
    mkdirSync(join(child, '.orca', 'rules'), { recursive: true })
    writeFileSync(join(child, '.orca', 'rules', '01-style.md'), '# Style Rule\nUse tabs.')
    writeFileSync(join(child, '.orca', 'rules', '02-safety.md'), '# Safety Rule\nNo force push.')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('25.15 discovers files from cwd (depth=0)', () => {
    const results = discoverGuidance(child, 0)
    expect(results.length).toBeGreaterThanOrEqual(1)
    const agents = results.find(r => r.source === 'AGENTS.md' && r.depth === 0)
    expect(agents).toBeDefined()
    expect(agents!.content).toContain('Project-specific')
  })

  it('25.16 discovers .orca/rules at cwd', () => {
    const results = discoverGuidance(child, 0)
    const rules = results.filter(r => r.source === '.orca/rules')
    expect(rules.length).toBe(2)
    expect(rules[0].content).toContain('Style Rule')
    expect(rules[1].content).toContain('Safety Rule')
  })

  it('25.17 discovers parent files with increasing depth', () => {
    const results = discoverGuidance(child, 2)
    const midCodex = results.find(r => r.source === 'CODEX.md')
    expect(midCodex).toBeDefined()
    expect(midCodex!.depth).toBe(1) // sub/ is parent of project/
  })

  it('25.18 discovers root-level files at depth=2', () => {
    const results = discoverGuidance(child, 2)
    const rootAgents = results.find(r => r.source === 'AGENTS.md' && r.depth === 2)
    expect(rootAgents).toBeDefined()
    expect(rootAgents!.content).toContain('Root Agents')
  })

  it('25.19 maxDepth=0 only scans cwd', () => {
    const results = discoverGuidance(child, 0)
    expect(results.every(r => r.depth === 0)).toBe(true)
  })

  it('25.20 empty directory returns empty array', () => {
    const empty = join(tmpdir(), `orca-empty-${Date.now()}`)
    mkdirSync(empty, { recursive: true })
    const results = discoverGuidance(empty, 0)
    expect(results.length).toBe(0)
    rmSync(empty, { recursive: true, force: true })
  })

  it('25.21 results sorted by depth ascending', () => {
    const results = discoverGuidance(child, 2)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].depth).toBeGreaterThanOrEqual(results[i - 1].depth)
    }
  })
})

describe('formatGuidanceForPrompt: prompt formatting', () => {
  it('25.22 empty guidance returns empty string', () => {
    expect(formatGuidanceForPrompt([])).toBe('')
  })

  it('25.23 formats guidance with headers', () => {
    const guidance = [
      { path: '/project/AGENTS.md', source: 'AGENTS.md' as const, content: 'Hello world', depth: 0 },
    ]
    const output = formatGuidanceForPrompt(guidance)
    expect(output).toContain('Project Guidance')
    expect(output).toContain('AGENTS.md')
    expect(output).toContain('Hello world')
  })

  it('25.24 truncates long content', () => {
    const longContent = 'x'.repeat(5000)
    const guidance = [
      { path: '/project/CLAUDE.md', source: 'CLAUDE.md' as const, content: longContent, depth: 0 },
    ]
    const output = formatGuidanceForPrompt(guidance, 100)
    expect(output).toContain('truncated')
    expect(output.length).toBeLessThan(5000)
  })

  it('25.25 depth hint shows ../ for parent directories', () => {
    const guidance = [
      { path: '/root/AGENTS.md', source: 'AGENTS.md' as const, content: 'Root', depth: 2 },
    ]
    const output = formatGuidanceForPrompt(guidance)
    expect(output).toContain('../../')
  })

  it('25.26 .orca/rules source shows rule filename in label', () => {
    const guidance = [
      { path: '/project/.orca/rules/01-style.md', source: '.orca/rules' as const, content: 'tabs', depth: 0 },
    ]
    const output = formatGuidanceForPrompt(guidance)
    expect(output).toContain('01-style.md')
  })
})
