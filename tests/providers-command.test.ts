import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createProvidersCommand } from '../src/commands/providers.js'

describe('providers command', () => {
  const envSnapshot = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ORCA_PROVIDER: process.env.ORCA_PROVIDER,
  }

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.ORCA_PROVIDER = 'openai'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (envSnapshot.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = envSnapshot.OPENAI_API_KEY

    if (envSnapshot.ORCA_PROVIDER === undefined) delete process.env.ORCA_PROVIDER
    else process.env.ORCA_PROVIDER = envSnapshot.ORCA_PROVIDER
  })

  it('lists provider metadata including context and pricing', async () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '))
    })

    const command = createProvidersCommand()
    await command.parseAsync(['node', 'orca', 'providers'])

    const output = logs.join('\n')
    expect(output).toContain('Configured Providers')
    expect(output).toContain('openai')
    expect(output).toContain('ctx')
    expect(output).toContain('/1M in/out')
    expect(output).not.toContain('$ $')
    spy.mockRestore()
  })
})
