import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gatherDoctorReport } from '../src/doctor.js'
import { createDoctorCommand } from '../src/commands/doctor.js'
import { vi } from 'vitest'

describe('doctor command diagnostics', () => {
  const previousHome = process.env.HOME
  const previousOrcaHome = process.env.ORCA_HOME
  let homeDir: string
  let projectDir: string

  beforeEach(() => {
    homeDir = join(tmpdir(), `orca-doctor-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    projectDir = join(tmpdir(), `orca-doctor-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(homeDir, { recursive: true })
    mkdirSync(projectDir, { recursive: true })
    process.env.HOME = homeDir
    process.env.ORCA_HOME = join(homeDir, '.orca')

    mkdirSync(join(projectDir, '.orca'), { recursive: true })
    mkdirSync(join(homeDir, '.orca', 'sessions'), { recursive: true })
    mkdirSync(join(homeDir, '.orca', 'background-jobs'), { recursive: true })
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      name: 'doctor-test',
      dependencies: { express: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }))
    writeFileSync(join(projectDir, '.orca', 'hooks.json'), JSON.stringify({
      SessionStart: [{ command: 'echo hello' }],
    }))
    writeFileSync(join(projectDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        demo: { command: 'node', args: ['-e', 'process.exit(0)'] },
      },
    }))
    writeFileSync(join(homeDir, '.orca', 'sessions', 'one.json'), JSON.stringify({
      model: 'gpt-5.4',
      history: [],
      stats: { turns: 1, inputTokens: 1, outputTokens: 1 },
      savedAt: new Date().toISOString(),
    }))
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.ORCA_PROVIDER = 'openai'
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousOrcaHome === undefined) delete process.env.ORCA_HOME
    else process.env.ORCA_HOME = previousOrcaHome
    delete process.env.OPENAI_API_KEY
    delete process.env.ORCA_PROVIDER
    try { rmSync(homeDir, { recursive: true, force: true }) } catch { /* ignore */ }
    try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('gathers provider, hook, MCP, session, and log diagnostics', () => {
    const report = gatherDoctorReport(projectDir)
    expect(report.project.name).toBe('doctor-test')
    expect(report.provider.activeProvider).toBe('openai')
    expect(report.hooksConfigured).toBe(1)
    expect(report.mcpConfigured).toBe(1)
    expect(report.sessionsSaved).toBe(1)
    expect(report.logs.agentPath).toContain('.orca')
    expect(report.configPaths.projectExists).toBe(false)
  })

  it('reports malformed config files in doctor diagnostics', () => {
    writeFileSync(join(projectDir, '.orca.json'), '{ invalid json')
    const report = gatherDoctorReport(projectDir)
    const projectConfig = report.configDiagnostics.find((entry) => entry.kind === 'project-config')
    expect(projectConfig?.exists).toBe(true)
    expect(projectConfig?.valid).toBe(false)
    expect(projectConfig?.error).toBeTruthy()
  })

  it('prints config issues in human-readable doctor output', async () => {
    writeFileSync(join(projectDir, '.orca.json'), '{ invalid json')
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')) })

    const command = createDoctorCommand()
    await command.parseAsync(['node', 'doctor', '--cwd', projectDir])

    const output = lines.join('\n')
    expect(output).toContain('config issues:')
    expect(output).toContain('project-config')
    vi.restoreAllMocks()
  })
})
