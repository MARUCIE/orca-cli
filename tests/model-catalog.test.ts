import { describe, it, expect } from 'vitest'
import { listModelChoices, getAgenticWarning, formatContextWindow, formatPricing } from '../src/model-catalog.js'
import type { OrcaConfig } from '../src/config.js'

describe('model catalog', () => {
  const baseConfig: OrcaConfig = {
    providers: {
      openai: {
        apiKey: 'test-openai',
        models: ['gpt-5.4', 'o4-mini'],
        defaultModel: 'gpt-5.4',
        disabled: false,
        aggregator: false,
      },
      google: {
        apiKey: 'test-google',
        models: ['gemini-3.1-pro', 'gemini-3.1-flash-lite'],
        defaultModel: 'gemini-3.1-pro',
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

  it('lists configured provider models first', () => {
    const models = listModelChoices(baseConfig)
    expect(models.some((m) => m.model === 'gpt-5.4' && m.provider === 'openai')).toBe(true)
    expect(models.some((m) => m.model === 'gemini-3.1-pro' && m.provider === 'google')).toBe(true)
  })

  it('injects current model if not present in config', () => {
    const models = listModelChoices(baseConfig, 'custom-agent-model')
    expect(models[0]!.model).toBe('custom-agent-model')
  })

  it('marks flash-lite as cautionary for agentic workflows', () => {
    expect(getAgenticWarning('gemini-3.1-flash-lite')).toContain('optimized for speed')
    const flash = listModelChoices(baseConfig).find((m) => m.model === 'gemini-3.1-flash-lite')
    expect(flash?.agentic).toBe('caution')
  })

  it('formats context windows and pricing for display', () => {
    expect(formatContextWindow(2_000_000)).toBe('2M')
    expect(formatContextWindow(256_000)).toBe('256K')
    expect(formatPricing([1.25, 10])).toBe('$1.25/$10')
  })

  it('recognizes gemini 2.5 metadata', () => {
    const gemini = listModelChoices({
      ...baseConfig,
      providers: {
        ...baseConfig.providers,
        google: {
          ...baseConfig.providers.google,
          models: ['gemini-2.5-pro'],
          defaultModel: 'gemini-2.5-pro',
        },
      },
    }).find((m) => m.model === 'gemini-2.5-pro')

    expect(gemini?.contextWindow).toBe(1_000_000)
    expect(gemini?.pricing).toEqual([1.25, 10])
  })
})
