import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('stats command', () => {
  const previousHome = process.env.HOME
  const previousOrcaHome = process.env.ORCA_HOME
  const previousProvider = process.env.ORCA_PROVIDER
  const previousOpenAIKey = process.env.OPENAI_API_KEY
  let homeDir: string

  beforeEach(() => {
    homeDir = join(tmpdir(), `orca-stats-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(homeDir, { recursive: true })
    process.env.HOME = homeDir
    process.env.ORCA_HOME = join(homeDir, '.orca')
    process.env.ORCA_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousOrcaHome === undefined) delete process.env.ORCA_HOME
    else process.env.ORCA_HOME = previousOrcaHome
    if (previousProvider === undefined) delete process.env.ORCA_PROVIDER
    else process.env.ORCA_PROVIDER = previousProvider
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousOpenAIKey
    try { rmSync(homeDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('shows runtime health and recent errors alongside usage stats', async () => {
    const { recordUsage } = await import('../src/usage-db.js')
    const { logError } = await import('../src/logger.js')
    const { createStatsCommand } = await import('../src/commands/stats.js')

    recordUsage({
      provider: 'openai',
      model: 'gpt-5.4',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
      durationMs: 1000,
      command: 'chat',
      cwd: process.cwd(),
    })
    logError('stats smoke error')

    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')) })

    const command = createStatsCommand()
    await command.parseAsync(['node', 'stats'])

    const output = logs.join('\n')
    expect(output).toContain('OVERVIEW')
    expect(output).toContain('COST & TOKENS')
    expect(output).toContain('RUNTIME HEALTH')
    expect(output).toContain('Recent Errors')
    expect(output).toContain('stats smoke error')
  })
})
