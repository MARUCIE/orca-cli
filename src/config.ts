/**
 * Orca CLI configuration system.
 *
 * Three-tier config resolution (highest priority wins):
 *   1. CLI flags + environment variables (runtime)
 *   2. Project-local .orca.json (project)
 *   3. Global ~/.orca/config.json (global)
 *
 * Provider architecture (v2):
 *   - Each provider is an independent config block with apiKey, baseURL, models
 *   - All providers use OpenAI-compatible protocol (single SDK)
 *   - ${ENV_VAR} template syntax lets config files be committed without secrets
 *   - Auto-migration from v1 flat config
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { logWarning } from './logger.js'

// ── Schema ──────────────────────────────────────────────────────────

/**
 * Per-provider configuration block.
 * Every provider speaks OpenAI-compatible protocol — baseURL is the differentiator.
 */
const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  models: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
  disabled: z.boolean().default(false),
  /** True for aggregators (Poe, OpenRouter, Zenmux) that route to multiple vendors via one endpoint */
  aggregator: z.boolean().default(false),
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

const OrcaConfigSchema = z.object({
  // v2: per-provider config blocks
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  defaultProvider: z.string().default('auto'),
  defaultModel: z.string().optional(),

  // Multi-model collaboration config
  multiModel: z.object({
    provider: z.string().optional(),
  }).default({}),

  // Agent settings (unchanged)
  maxTurns: z.number().int().positive().default(25),
  maxBudgetUsd: z.number().positive().optional(),
  systemPrompt: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).default('default'),
  mcpServers: z.record(z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })).optional(),
  tools: z.array(z.string()).optional(),

  // v1 compat fields (consumed by migration, not used directly)
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
})

export type OrcaConfig = z.infer<typeof OrcaConfigSchema>

// Legacy type alias for backward-compatible imports
export type Provider = string

// ── Paths ───────────────────────────────────────────────────────────

const GLOBAL_DIR = join(homedir(), '.orca')
const GLOBAL_CONFIG = join(GLOBAL_DIR, 'config.json')
const PROJECT_CONFIG = '.orca.json'

export function getGlobalDir(): string {
  return GLOBAL_DIR
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG
}

// ── Env Template Resolver ───────────────────────────────────────────

/**
 * Resolve ${ENV_VAR} templates in a string.
 * Returns undefined if the referenced env var is not set.
 *
 * Examples:
 *   "${POE_API_KEY}" → actual value of process.env.POE_API_KEY
 *   "sk-hardcoded"   → "sk-hardcoded" (no template, returned as-is)
 *   "${UNSET_VAR}"   → undefined
 */
function resolveEnvTemplate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = value.match(/^\$\{(\w+)\}$/)
  if (match) {
    return process.env[match[1]!] || undefined
  }
  return value
}

// ── Well-Known Provider Defaults ────────────────────────────────────

interface ProviderDefaults {
  baseURL: string
  envKey: string
  defaultModel: string
}

const WELL_KNOWN_PROVIDERS: Record<string, ProviderDefaults> = {
  poe: {
    baseURL: 'https://api.poe.com/v1/',
    envKey: 'POE_API_KEY',
    defaultModel: 'claude-sonnet-4.6',
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com/v1/',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1/',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.4',
  },
  google: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    envKey: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.5-pro',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-sonnet-4',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-4-scout-17b-16e-instruct',
  },
  xai: {
    baseURL: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
    defaultModel: 'grok-4',
  },
  local: {
    baseURL: 'http://localhost:11434/v1',
    envKey: 'LOCAL_API_KEY',
    defaultModel: 'qwen3:32b',
  },
}

// ── Loaders ─────────────────────────────────────────────────────────

function loadJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logWarning('failed to parse config file', { path, error: msg })
    return {}
  }
}

function loadGlobalConfig(): Record<string, unknown> {
  return loadJsonFile(GLOBAL_CONFIG)
}

function loadProjectConfig(cwd: string): Record<string, unknown> {
  return loadJsonFile(join(resolve(cwd), PROJECT_CONFIG))
}

// ── V1 Config Migration ────────────────────────────────────────────

/**
 * Detect and migrate v1 flat config to v2 providers format.
 *
 * v1: { "provider": "poe", "apiKey": "...", "model": "...", "baseURL": "..." }
 * v2: { "providers": { "poe": { "apiKey": "...", "baseURL": "..." } }, "defaultProvider": "poe" }
 */
function migrateV1Config(raw: Record<string, unknown>): Record<string, unknown> {
  // Already v2 if providers key exists
  if (raw.providers && typeof raw.providers === 'object') return raw

  // No v1 provider field — nothing to migrate
  if (!raw.provider || typeof raw.provider !== 'string') return raw

  const v1Provider = raw.provider as string
  if (v1Provider === 'auto') return raw // auto needs detection, not migration

  const providerConfig: Record<string, unknown> = {}
  if (raw.apiKey) providerConfig.apiKey = raw.apiKey
  if (raw.baseURL) providerConfig.baseURL = raw.baseURL
  if (raw.model) providerConfig.defaultModel = raw.model

  const migrated: Record<string, unknown> = { ...raw }
  migrated.providers = { [v1Provider]: providerConfig }
  migrated.defaultProvider = v1Provider
  if (raw.model) migrated.defaultModel = raw.model as string

  // Clean up v1 fields
  delete migrated.provider
  delete migrated.apiKey
  delete migrated.baseURL
  delete migrated.model

  return migrated
}

// ── Environment Variable Mapping ────────────────────────────────────

function loadEnvOverrides(): Record<string, unknown> {
  const env: Record<string, unknown> = {}

  if (process.env.ORCA_PROVIDER) env.defaultProvider = process.env.ORCA_PROVIDER
  if (process.env.ORCA_MODEL) env.defaultModel = process.env.ORCA_MODEL
  if (process.env.ORCA_MAX_TURNS) env.maxTurns = parseInt(process.env.ORCA_MAX_TURNS, 10)
  if (process.env.ORCA_MAX_BUDGET) env.maxBudgetUsd = parseFloat(process.env.ORCA_MAX_BUDGET)
  if (process.env.ORCA_PERMISSION_MODE) env.permissionMode = process.env.ORCA_PERMISSION_MODE
  if (process.env.ORCA_SYSTEM_PROMPT) env.systemPrompt = process.env.ORCA_SYSTEM_PROMPT
  if (process.env.ORCA_BASE_URL) env.baseURL = process.env.ORCA_BASE_URL

  return env
}

// ── Resolver ────────────────────────────────────────────────────────

export interface ResolveConfigOptions {
  cwd?: string
  flags?: Partial<OrcaConfig>
}

/**
 * Resolve configuration from all three tiers.
 * Priority: flags > env > project > global > defaults
 */
export function resolveConfig(options: ResolveConfigOptions = {}): OrcaConfig {
  const { cwd = process.cwd(), flags = {} } = options

  const global = migrateV1Config(loadGlobalConfig())
  const project = migrateV1Config(loadProjectConfig(cwd))
  const env = loadEnvOverrides()

  // Deep-merge providers from all layers
  const mergedProviders = deepMergeProviders(
    (global.providers || {}) as Record<string, Record<string, unknown>>,
    (project.providers || {}) as Record<string, Record<string, unknown>>,
  )

  // Merge top-level fields
  const merged: Record<string, unknown> = {
    ...global,
    ...project,
    ...env,
    ...stripUndefined(flags as Record<string, unknown>),
    providers: mergedProviders,
  }

  // Handle v1 CLI flags (--provider, --api-key, --model) for backward compat
  const flagProvider = (flags as Record<string, unknown>).provider as string | undefined
  const flagApiKey = (flags as Record<string, unknown>).apiKey as string | undefined
  const flagModel = (flags as Record<string, unknown>).model as string | undefined

  // -m flag always promotes to defaultModel (highest priority in resolution chain)
  if (flagModel) {
    merged.defaultModel = flagModel
  }

  if (flagProvider && flagProvider !== 'auto') {
    merged.defaultProvider = flagProvider
    // Inject flag values into the provider block
    const providers = merged.providers as Record<string, Record<string, unknown>>
    const p = providers[flagProvider] || {}
    if (flagApiKey) p.apiKey = flagApiKey
    providers[flagProvider] = p
  }

  try {
    return OrcaConfigSchema.parse(merged)
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
      throw new Error(`Invalid configuration:\n${issues}`)
    }
    throw err
  }
}

// ── Init ────────────────────────────────────────────────────────────

/**
 * Initialize global config directory and optionally write a project config.
 */
export function initGlobalConfig(): void {
  if (!existsSync(GLOBAL_DIR)) {
    mkdirSync(GLOBAL_DIR, { recursive: true })
  }
  if (!existsSync(GLOBAL_CONFIG)) {
    writeFileSync(GLOBAL_CONFIG, JSON.stringify({
      providers: {
        anthropic: {
          apiKey: '${ANTHROPIC_API_KEY}',
          defaultModel: 'claude-sonnet-4-20250514',
        },
      },
      defaultProvider: 'auto',
      maxTurns: 25,
    }, null, 2) + '\n', 'utf-8')
  }
}

export function initProjectConfig(cwd: string): string {
  const path = join(resolve(cwd), PROJECT_CONFIG)
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({
      defaultProvider: 'auto',
      systemPrompt: '',
      tools: [],
      mcpServers: {},
    }, null, 2) + '\n', 'utf-8')
  }
  return path
}

// ── Provider Resolution ─────────────────────────────────────────────

/**
 * Resolve which provider to use and return connection details.
 *
 * Resolution chain:
 *   1. If defaultProvider is explicit (not "auto"), use that provider's config
 *   2. If "auto", scan providers map for first one with a valid apiKey
 *   3. If no configured provider has a key, scan well-known env vars
 *   4. Fill in defaults from WELL_KNOWN_PROVIDERS
 *
 * The sdkProvider is always 'openai' — Orca uses a single SDK.
 */
export function resolveProvider(config: OrcaConfig): {
  provider: string
  apiKey: string
  model: string
  baseURL?: string
  sdkProvider: 'anthropic' | 'openai'
} {
  const providerId = config.defaultProvider === 'auto'
    ? detectProvider(config)
    : config.defaultProvider

  const providerConfig = config.providers[providerId] || {}
  const wellKnown = WELL_KNOWN_PROVIDERS[providerId]

  // Resolve apiKey: config (with env template) > well-known env var > v1 compat apiKey > ORCA_API_KEY
  const apiKey =
    resolveEnvTemplate(providerConfig.apiKey) ||
    (wellKnown ? process.env[wellKnown.envKey] : undefined) ||
    config.apiKey ||  // v1 compat: flat apiKey from flags
    process.env.ORCA_API_KEY

  if (!apiKey) {
    const envHint = wellKnown ? wellKnown.envKey : `${providerId.toUpperCase()}_API_KEY`
    throw new Error(
      `No API key for provider "${providerId}". ` +
      `Set ${envHint}, or configure providers.${providerId}.apiKey in ~/.orca/config.json`
    )
  }

  // Resolve model: CLI defaultModel > v1 compat model > provider defaultModel > provider models[0] > well-known default
  const model =
    config.defaultModel ||
    config.model ||  // v1 compat: flat model from flags
    providerConfig.defaultModel ||
    providerConfig.models?.[0] ||
    (wellKnown ? wellKnown.defaultModel : 'claude-sonnet-4-20250514')

  // Resolve baseURL: config (with env template) > well-known default
  const baseURL =
    resolveEnvTemplate(providerConfig.baseURL) ||
    (wellKnown ? wellKnown.baseURL : undefined)

  // Orca always uses OpenAI-compatible protocol
  const sdkProvider = 'openai' as const

  return { provider: providerId, apiKey, model, baseURL, sdkProvider }
}

/**
 * Auto-detect the best provider from configured providers + env vars.
 *
 * Priority:
 *   1. Configured providers with resolvable apiKey (in config order)
 *   2. Well-known env vars (anthropic > openai > google > poe)
 */
function detectProvider(config: OrcaConfig): string {
  // Check model name hint first (v2 defaultModel or v1 compat model)
  const modelHint = config.defaultModel || config.model
  if (modelHint) {
    const m = modelHint.toLowerCase()
    if (m.startsWith('claude') || m.startsWith('anthropic')) return 'anthropic'
    if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai'
    if (m.startsWith('gemini')) return 'google'
    if (m.startsWith('deepseek')) return 'deepseek'
    if (m.startsWith('grok')) return 'xai'
    if (m.startsWith('llama') || m.startsWith('qwen') || m.startsWith('kimi')) return 'local'
  }

  // Scan configured providers for one with a resolvable key
  for (const [id, pc] of Object.entries(config.providers)) {
    if (pc.disabled) continue
    const key = resolveEnvTemplate(pc.apiKey)
    if (key) return id
  }

  // Fall back to well-known env vars (preferred order: direct APIs first)
  const scanOrder = ['anthropic', 'openai', 'google', 'deepseek', 'openrouter', 'groq', 'xai', 'poe']
  for (const id of scanOrder) {
    const wk = WELL_KNOWN_PROVIDERS[id]
    if (wk && process.env[wk.envKey]) return id
  }

  return 'anthropic' // ultimate default
}

// ── Provider Listing (for `orca providers` command) ────────────────

export interface ProviderInfo {
  id: string
  baseURL: string
  hasKey: boolean
  model: string
  disabled: boolean
  source: 'config' | 'env' | 'well-known'
}

/**
 * List all available providers (configured + well-known with env keys).
 */
export function listProviders(config: OrcaConfig): ProviderInfo[] {
  const result: ProviderInfo[] = []
  const seen = new Set<string>()

  // Configured providers
  for (const [id, pc] of Object.entries(config.providers)) {
    seen.add(id)
    const wk = WELL_KNOWN_PROVIDERS[id]
    const hasKey = !!(resolveEnvTemplate(pc.apiKey) || (wk ? process.env[wk.envKey] : false))
    result.push({
      id,
      baseURL: resolveEnvTemplate(pc.baseURL) || wk?.baseURL || '(not set)',
      hasKey,
      model: pc.defaultModel || pc.models?.[0] || wk?.defaultModel || '(not set)',
      disabled: pc.disabled ?? false,
      source: 'config',
    })
  }

  // Well-known providers with env keys but not in config
  for (const [id, wk] of Object.entries(WELL_KNOWN_PROVIDERS)) {
    if (seen.has(id)) continue
    if (process.env[wk.envKey]) {
      result.push({
        id,
        baseURL: wk.baseURL,
        hasKey: true,
        model: wk.defaultModel,
        disabled: false,
        source: 'env',
      })
    }
  }

  return result
}

// ── Model Endpoint Resolution (for multi-model) ────────────────────

export interface ModelEndpoint {
  model: string
  apiKey: string
  baseURL: string
  provider: string
}

/**
 * Model name prefix → provider mapping for auto-detection.
 */
const MODEL_PREFIX_TO_PROVIDER: Array<[string, string]> = [
  ['claude', 'anthropic'],
  ['anthropic', 'anthropic'],
  ['gpt', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['o4', 'openai'],
  ['gemini', 'google'],
  ['gemma', 'google'],
  ['deepseek', 'deepseek'],
  ['grok', 'xai'],
  ['qwen', 'local'],
  ['llama', 'local'],
  ['kimi', 'local'],
  ['glm', 'local'],
  ['minimax', 'local'],
]

function detectProviderForModel(model: string): string | undefined {
  const lower = model.toLowerCase()
  for (const [prefix, provider] of MODEL_PREFIX_TO_PROVIDER) {
    if (lower.startsWith(prefix)) return provider
  }
  return undefined
}

/**
 * Resolve the endpoint (apiKey + baseURL) for a specific model.
 *
 * Strategy:
 *   1. If an aggregator provider is specified and available, use it (single endpoint for all models)
 *   2. Otherwise, detect which direct provider owns this model and use that provider's endpoint
 *   3. Fall back to the default provider
 *
 * This enables council/race/pipeline to send each model to the right endpoint.
 */
export function resolveModelEndpoint(
  model: string,
  config: OrcaConfig,
  aggregatorId?: string,
): ModelEndpoint | null {
  // Path 1: Aggregator available — use it for everything
  if (aggregatorId) {
    const agg = config.providers[aggregatorId]
    if (agg && !agg.disabled) {
      const wk = WELL_KNOWN_PROVIDERS[aggregatorId]
      const apiKey = resolveEnvTemplate(agg.apiKey) || (wk ? process.env[wk.envKey] : undefined)
      const baseURL = resolveEnvTemplate(agg.baseURL) || wk?.baseURL
      if (apiKey && baseURL) {
        return { model, apiKey, baseURL, provider: aggregatorId }
      }
    }
  }

  // Path 2: Direct provider routing — find who owns this model
  const detectedProvider = detectProviderForModel(model)
  if (detectedProvider) {
    const pc = config.providers[detectedProvider]
    const wk = WELL_KNOWN_PROVIDERS[detectedProvider]
    const apiKey = resolveEnvTemplate(pc?.apiKey) || (wk ? process.env[wk.envKey] : undefined)
    const baseURL = resolveEnvTemplate(pc?.baseURL) || wk?.baseURL
    if (apiKey && baseURL) {
      return { model, apiKey, baseURL, provider: detectedProvider }
    }
  }

  // Path 3: Fall back to default provider
  try {
    const resolved = resolveProvider(config)
    if (resolved.baseURL) {
      return { model, apiKey: resolved.apiKey, baseURL: resolved.baseURL, provider: resolved.provider }
    }
  } catch { /* no default available */ }

  return null
}

/**
 * Find the best aggregator provider from config, or undefined if none available.
 * Checks multiModel.provider first, then scans for any enabled aggregator with a key.
 */
export function findAggregator(config: OrcaConfig): string | undefined {
  // Explicit multiModel.provider — must be a true aggregator (aggregator: true)
  const explicit = config.multiModel?.provider
  if (explicit) {
    const pc = config.providers[explicit]
    if (pc && !pc.disabled && pc.aggregator) {
      const wk = WELL_KNOWN_PROVIDERS[explicit]
      const hasKey = !!(resolveEnvTemplate(pc.apiKey) || (wk ? process.env[wk.envKey] : undefined))
      if (hasKey) return explicit
    }
  }

  // Scan for any aggregator with a key
  for (const [id, pc] of Object.entries(config.providers)) {
    if (!pc.aggregator || pc.disabled) continue
    const wk = WELL_KNOWN_PROVIDERS[id]
    const hasKey = !!(resolveEnvTemplate(pc.apiKey) || (wk ? process.env[wk.envKey] : undefined))
    if (hasKey) return id
  }

  return undefined
}

// ── Helpers ─────────────────────────────────────────────────────────

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  )
}

function deepMergeProviders(
  ...layers: Array<Record<string, Record<string, unknown>>>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const layer of layers) {
    for (const [id, config] of Object.entries(layer)) {
      result[id] = { ...(result[id] || {}), ...config }
    }
  }
  return result
}
