import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOrcaHttpServer, type ServerState } from '../src/commands/serve.js'
import type { OrcaConfig } from '../src/config.js'

describe('serve command http server', () => {
  const previousHome = process.env.HOME
  const previousOrcaHome = process.env.ORCA_HOME
  const previousOrcaProvider = process.env.ORCA_PROVIDER
  const previousOpenAIKey = process.env.OPENAI_API_KEY
  let homeDir: string
  let projectDir: string

  beforeEach(() => {
    homeDir = join(tmpdir(), `orca-serve-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    projectDir = join(tmpdir(), `orca-serve-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(homeDir, { recursive: true })
    mkdirSync(projectDir, { recursive: true })
    process.env.HOME = homeDir
    process.env.ORCA_HOME = join(homeDir, '.orca')
    process.env.ORCA_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    mkdirSync(join(homeDir, '.orca', 'sessions'), { recursive: true })
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'serve-test', devDependencies: { vitest: '^1.0.0' } }))
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousOrcaHome === undefined) delete process.env.ORCA_HOME
    else process.env.ORCA_HOME = previousOrcaHome
    if (previousOrcaProvider === undefined) delete process.env.ORCA_PROVIDER
    else process.env.ORCA_PROVIDER = previousOrcaProvider
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousOpenAIKey
    try { rmSync(homeDir, { recursive: true, force: true }) } catch { /* ignore */ }
    try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('serves health, providers, and doctor metadata', async () => {
    const config: OrcaConfig = {
      providers: {
        openai: {
          apiKey: 'test-openai-key',
          baseURL: 'https://api.openai.com/v1/',
          models: ['gpt-5.4'],
          defaultModel: 'gpt-5.4',
          disabled: false,
          aggregator: false,
        },
      },
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4',
      multiModel: {},
      maxTurns: 25,
      permissionMode: 'default',
    }

    const state: ServerState = {
      config,
      resolved: {
        provider: 'openai',
        apiKey: 'test-openai-key',
        model: 'gpt-5.4',
        baseURL: 'https://api.openai.com/v1/',
        sdkProvider: 'openai',
      },
      cwd: projectDir,
    }

    const server = createOrcaHttpServer(state)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())
      expect(health.status).toBe('ok')
      expect(health.modelMetadata.model).toBe('gpt-5.4')
      expect(health.modelMetadata.contextWindow).toBe(256000)

      const providers = await fetch(`http://127.0.0.1:${port}/providers`).then((r) => r.json())
      expect(providers.default).toBe('openai')
      expect(providers.providers[0].modelMetadata.model).toBe('gpt-5.4')

      const doctor = await fetch(`http://127.0.0.1:${port}/doctor`).then((r) => r.json())
      expect(doctor.project.name).toBe('serve-test')
      expect(doctor.provider.activeProvider).toBe('openai')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
    }
  })
})
