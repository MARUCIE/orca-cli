/**
 * Forge CLI configuration system.
 *
 * Three-tier config resolution (highest priority wins):
 *   1. CLI flags + environment variables (runtime)
 *   2. Project-local .armature.json (project)
 *   3. Global ~/.armature/config.json (global)
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'

// ── Schema ──────────────────────────────────────────────────────────

const ProviderSchema = z.enum([
  'anthropic',
  'openai',
  'google',
  'poe',
  'auto',
]).default('auto')

const ForgeConfigSchema = z.object({
  provider: ProviderSchema,
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
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
})

export type ForgeConfig = z.infer<typeof ForgeConfigSchema>
export type Provider = z.infer<typeof ProviderSchema>

// ── Paths ───────────────────────────────────────────────────────────

const GLOBAL_DIR = join(homedir(), '.armature')
const GLOBAL_CONFIG = join(GLOBAL_DIR, 'config.json')
const PROJECT_CONFIG = '.armature.json'

export function getGlobalDir(): string {
  return GLOBAL_DIR
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG
}

// ── Loaders ─────────────────────────────────────────────────────────

function loadJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`warn: failed to parse ${path}: ${msg}`)
    return {}
  }
}

function loadGlobalConfig(): Record<string, unknown> {
  return loadJsonFile(GLOBAL_CONFIG)
}

function loadProjectConfig(cwd: string): Record<string, unknown> {
  return loadJsonFile(join(resolve(cwd), PROJECT_CONFIG))
}

// ── Environment Variable Mapping ────────────────────────────────────

function loadEnvConfig(): Record<string, unknown> {
  const env: Record<string, unknown> = {}

  if (process.env.ARMATURE_PROVIDER) env.provider = process.env.ARMATURE_PROVIDER
  if (process.env.ARMATURE_MODEL) env.model = process.env.ARMATURE_MODEL
  if (process.env.ARMATURE_MAX_TURNS) env.maxTurns = parseInt(process.env.ARMATURE_MAX_TURNS, 10)
  if (process.env.ARMATURE_MAX_BUDGET) env.maxBudgetUsd = parseFloat(process.env.ARMATURE_MAX_BUDGET)
  if (process.env.ARMATURE_PERMISSION_MODE) env.permissionMode = process.env.ARMATURE_PERMISSION_MODE
  if (process.env.ARMATURE_SYSTEM_PROMPT) env.systemPrompt = process.env.ARMATURE_SYSTEM_PROMPT

  // API key resolution: provider-specific first, then generic
  const apiKey =
    process.env.ARMATURE_API_KEY ||
    process.env.POE_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY
  if (apiKey) env.apiKey = apiKey

  if (process.env.ARMATURE_BASE_URL) env.baseURL = process.env.ARMATURE_BASE_URL

  return env
}

// ── Resolver ────────────────────────────────────────────────────────

export interface ResolveConfigOptions {
  cwd?: string
  flags?: Partial<ForgeConfig>
}

/**
 * Resolve configuration from all three tiers.
 * Priority: flags > env > project > global > defaults
 */
export function resolveConfig(options: ResolveConfigOptions = {}): ForgeConfig {
  const { cwd = process.cwd(), flags = {} } = options

  const global = loadGlobalConfig()
  const project = loadProjectConfig(cwd)
  const env = loadEnvConfig()

  // Merge layers (later overrides earlier)
  const merged = {
    ...global,
    ...project,
    ...env,
    ...stripUndefined(flags),
  }

  try {
    return ForgeConfigSchema.parse(merged)
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
      provider: 'auto',
      maxTurns: 25,
    }, null, 2) + '\n', 'utf-8')
  }
}

export function initProjectConfig(cwd: string): string {
  const path = join(resolve(cwd), PROJECT_CONFIG)
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify({
      provider: 'auto',
      systemPrompt: '',
      tools: [],
      mcpServers: {},
    }, null, 2) + '\n', 'utf-8')
  }
  return path
}

// ── Provider Auto-Detection ─────────────────────────────────────────

/**
 * Determine the best provider based on config and available API keys.
 *
 * For proxy providers (poe), the baseURL is injected automatically.
 * The SDK always uses the OpenAI-compatible protocol for proxy providers.
 */
export function resolveProvider(config: ForgeConfig): {
  provider: string
  apiKey: string
  model: string
  baseURL?: string
  sdkProvider: 'anthropic' | 'openai'
} {
  const provider = config.provider === 'auto' ? detectProvider(config) : config.provider

  const apiKey = config.apiKey || getProviderApiKey(provider)
  if (!apiKey) {
    throw new Error(
      `No API key found for provider "${provider}". ` +
      `Set ARMATURE_API_KEY, ${provider.toUpperCase()}_API_KEY, or configure in ~/.armature/config.json`
    )
  }

  const model = config.model || getDefaultModel(provider)
  const baseURL = config.baseURL || getProviderBaseURL(provider)

  // Proxy providers (poe) use OpenAI-compatible protocol
  const sdkProvider = getSDKProvider(provider)

  return { provider, apiKey, model, baseURL, sdkProvider }
}

function detectProvider(config: ForgeConfig): string {
  // If model name hints at a provider, use that (case-insensitive for Poe compatibility)
  if (config.model) {
    const m = config.model.toLowerCase()
    if (m.startsWith('claude') || m.startsWith('anthropic')) return 'anthropic'
    if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai'
    if (m.startsWith('gemini')) return 'google'
  }

  // Fall back to whichever API key is available
  if (process.env.POE_API_KEY) return 'poe'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.GOOGLE_API_KEY) return 'google'

  return 'anthropic' // ultimate default
}

function getProviderApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'poe': return process.env.POE_API_KEY
    case 'anthropic': return process.env.ANTHROPIC_API_KEY
    case 'openai': return process.env.OPENAI_API_KEY
    case 'google': return process.env.GOOGLE_API_KEY
    default: return undefined
  }
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'poe': return 'claude-sonnet-4.6'
    case 'anthropic': return 'claude-sonnet-4-20250514'
    case 'openai': return 'gpt-5.4'
    case 'google': return 'gemini-3.1-pro'
    default: return 'claude-sonnet-4.6'
  }
}

/**
 * Get the base URL for proxy providers.
 * Poe uses OpenAI-compatible protocol at api.poe.com.
 */
function getProviderBaseURL(provider: string): string | undefined {
  switch (provider) {
    case 'poe': return 'https://api.poe.com/v1/'
    default: return undefined
  }
}

/**
 * Map logical provider to SDK provider protocol.
 * Proxy providers (poe) route through OpenAI-compatible protocol.
 */
function getSDKProvider(provider: string): 'anthropic' | 'openai' {
  switch (provider) {
    case 'poe': return 'openai'  // Poe is OpenAI-compatible
    case 'openai': return 'openai'
    default: return 'anthropic'
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  )
}
