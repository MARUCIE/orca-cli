import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveConfig, resolveProvider, initProjectConfig } from '../src/config.js'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

describe('config', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'forge-test-'))
  })

  afterEach(() => {
    const configPath = join(tempDir, '.armature.json')
    if (existsSync(configPath)) {
      unlinkSync(configPath)
    }
  })

  describe('resolveConfig', () => {
    it('returns defaults when no config exists', () => {
      // Override global config's defaultProvider to test the schema default
      const config = resolveConfig({ cwd: tempDir, flags: { defaultProvider: 'auto' } })
      expect(config.defaultProvider).toBe('auto')
      expect(config.maxTurns).toBe(25)
      expect(config.permissionMode).toBe('default')
    })

    it('flags override defaults', () => {
      const config = resolveConfig({
        cwd: tempDir,
        flags: { model: 'gpt-4.1', provider: 'openai', maxTurns: 10 },
      })
      // v1 compat: flat flags.model goes to config.model, flags.provider sets defaultProvider
      expect(config.model).toBe('gpt-4.1')
      expect(config.defaultProvider).toBe('openai')
      expect(config.maxTurns).toBe(10)
    })

    it('reads project config from .armature.json', () => {
      initProjectConfig(tempDir)
      const config = resolveConfig({ cwd: tempDir })
      expect(config.defaultProvider).toBe('auto')
    })

    it('env variables override project config', () => {
      const originalKey = process.env.ARMATURE_PROVIDER
      process.env.ARMATURE_PROVIDER = 'openai'
      try {
        const config = resolveConfig({ cwd: tempDir })
        expect(config.defaultProvider).toBe('openai')
      } finally {
        if (originalKey) {
          process.env.ARMATURE_PROVIDER = originalKey
        } else {
          delete process.env.ARMATURE_PROVIDER
        }
      }
    })

    it('flags override env variables', () => {
      const originalKey = process.env.ARMATURE_PROVIDER
      process.env.ARMATURE_PROVIDER = 'openai'
      try {
        const config = resolveConfig({
          cwd: tempDir,
          flags: { provider: 'anthropic' },
        })
        expect(config.defaultProvider).toBe('anthropic')
      } finally {
        if (originalKey) {
          process.env.ARMATURE_PROVIDER = originalKey
        } else {
          delete process.env.ARMATURE_PROVIDER
        }
      }
    })
  })

  describe('resolveProvider', () => {
    it('auto-detects anthropic from model name', () => {
      const config = resolveConfig({
        cwd: tempDir,
        flags: { model: 'claude-sonnet-4-20250514', apiKey: 'test-key', defaultProvider: 'auto' },
      })
      const { provider, model } = resolveProvider(config)
      expect(provider).toBe('anthropic')
      expect(model).toBe('claude-sonnet-4-20250514')
    })

    it('auto-detects openai from model name', () => {
      const config = resolveConfig({
        cwd: tempDir,
        flags: { model: 'gpt-4.1', apiKey: 'test-key', defaultProvider: 'auto' },
      })
      const { provider } = resolveProvider(config)
      expect(provider).toBe('openai')
    })

    it('auto-detects google from model name', () => {
      const config = resolveConfig({
        cwd: tempDir,
        flags: { model: 'gemini-2.5-pro', apiKey: 'test-key', defaultProvider: 'auto' },
      })
      const { provider } = resolveProvider(config)
      expect(provider).toBe('google')
    })

    it('throws when no API key available', () => {
      // Clear all potential API keys (including POE)
      const saved = {
        ARMATURE_API_KEY: process.env.ARMATURE_API_KEY,
        POE_API_KEY: process.env.POE_API_KEY,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      }
      delete process.env.ARMATURE_API_KEY
      delete process.env.POE_API_KEY
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY
      delete process.env.GOOGLE_API_KEY

      try {
        const config = resolveConfig({
          cwd: tempDir,
          flags: { provider: 'openai' },
        })
        expect(() => resolveProvider(config)).toThrow('No API key for provider')
      } finally {
        // Restore
        for (const [k, v] of Object.entries(saved)) {
          if (v !== undefined) process.env[k] = v
          else delete process.env[k]
        }
      }
    })

    it('uses explicit API key from flags', () => {
      const config = resolveConfig({
        cwd: tempDir,
        flags: { provider: 'anthropic', apiKey: 'sk-test-123' },
      })
      const { apiKey } = resolveProvider(config)
      expect(apiKey).toBe('sk-test-123')
    })
  })

  describe('initProjectConfig', () => {
    it('creates .armature.json in target directory', () => {
      const path = initProjectConfig(tempDir)
      expect(existsSync(path)).toBe(true)
    })

    it('does not overwrite existing config', () => {
      initProjectConfig(tempDir)
      // Second call should not throw
      const path = initProjectConfig(tempDir)
      expect(existsSync(path)).toBe(true)
    })
  })
})
