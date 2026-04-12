/**
 * Hermes-inspired model catalog for Orca CLI.
 *
 * Purpose:
 * - Replace hard-coded `/models` lists with provider-aware choices
 * - Surface context window and approximate pricing alongside models
 * - Warn when a model looks weak for multi-step agentic coding workflows
 */

import type { OrcaConfig } from './config.js'
import { listProviders } from './config.js'

export interface ModelChoice {
  model: string
  provider: string
  contextWindow?: number
  maxOutput?: number
  pricing?: [number, number]
  agentic: 'recommended' | 'caution' | 'unknown'
  note?: string
}

const DEFAULT_MODELS = [
  { provider: 'anthropic', model: 'claude-opus-4.6' },
  { provider: 'anthropic', model: 'claude-sonnet-4.6' },
  { provider: 'openai', model: 'gpt-5.4' },
  { provider: 'google', model: 'gemini-3.1-pro' },
  { provider: 'google', model: 'gemini-3.1-flash-lite' },
  { provider: 'google', model: 'gemma-4-31b' },
  { provider: 'xai', model: 'grok-4.20-multi-agent' },
  { provider: 'local', model: 'qwen3.6-plus' },
  { provider: 'local', model: 'kimi-k2.5' },
  { provider: 'local', model: 'glm-5' },
  { provider: 'local', model: 'minimax-m2.7' },
] as const

const MODEL_CONTEXT: Array<[string, number]> = [
  ['claude-opus-4', 200_000],
  ['claude-sonnet-4', 200_000],
  ['gpt-5', 256_000],
  ['gpt-4.1', 1_000_000],
  ['gpt-4o', 128_000],
  ['gemini-2.5', 1_000_000],
  ['gemini-2.0', 1_000_000],
  ['gemini-3', 2_000_000],
  ['gemma-4', 128_000],
  ['glm-5', 128_000],
  ['grok-4', 256_000],
  ['qwen3', 128_000],
  ['kimi-k2', 256_000],
  ['minimax-m2', 128_000],
]

const MODEL_MAX_OUTPUT: Array<[string, number]> = [
  ['claude-opus-4', 32_000],
  ['claude-sonnet-4', 64_000],
  ['gpt-5', 64_000],
  ['gpt-4.1', 32_000],
  ['gpt-4o', 16_384],
  ['gemini-2.5', 65_536],
  ['gemini-2.0', 8_192],
  ['gemini-3', 65_536],
  ['gemma-4', 8_192],
  ['glm-5', 8_192],
  ['grok-4', 32_000],
  ['qwen3', 32_000],
  ['kimi-k2', 32_000],
  ['minimax-m2', 16_384],
]

const MODEL_PRICING: Array<[string, [number, number]]> = [
  ['claude-opus', [15, 75]],
  ['claude-sonnet', [3, 15]],
  ['claude-haiku', [0.25, 1.25]],
  ['gpt-5', [1.25, 10]],
  ['gpt-4o', [2.5, 10]],
  ['gpt-4.1', [2, 8]],
  ['gpt-4.1-mini', [0.4, 1.6]],
  ['o3', [10, 40]],
  ['o4-mini', [1.1, 4.4]],
  ['gemini-2.5-pro', [1.25, 10]],
  ['gemini-2.5-flash', [0.15, 0.6]],
  ['gemini-2.0-flash', [0.1, 0.4]],
  ['gemini-3.1-pro', [1.25, 10]],
  ['gemini-3.1-flash-lite', [0.1, 0.4]],
  ['poe', [3, 15]],
]

const AGENTIC_CAUTION_RULES: Array<[RegExp, string]> = [
  [/flash-lite/i, 'optimized for speed and auxiliary work; tool-use quality may be weaker on complex coding tasks'],
  [/gemma/i, 'open-weight model; treat as lower-confidence for multi-step autonomous editing'],
  [/minimax/i, 'creative generation bias may require tighter verification on coding workflows'],
]

function lookupByPrefix<T>(model: string, entries: Array<[string, T]>): T | undefined {
  const lower = model.toLowerCase()
  for (const [prefix, value] of entries) {
    if (lower.includes(prefix)) return value
  }
  return undefined
}

export function getContextWindowForModel(model: string): number | undefined {
  return lookupByPrefix(model, MODEL_CONTEXT)
}

export function getMaxOutputForModel(model: string): number | undefined {
  return lookupByPrefix(model, MODEL_MAX_OUTPUT)
}

export function getPricingForModel(model: string): [number, number] | undefined {
  return lookupByPrefix(model, MODEL_PRICING)
}

export function getAgenticWarning(model: string): string | undefined {
  for (const [pattern, warning] of AGENTIC_CAUTION_RULES) {
    if (pattern.test(model)) return warning
  }
  return undefined
}

export function getModelChoice(model: string, provider: string): ModelChoice {
  const warning = getAgenticWarning(model)
  return {
    model,
    provider,
    contextWindow: getContextWindowForModel(model),
    maxOutput: getMaxOutputForModel(model),
    pricing: getPricingForModel(model),
    agentic: warning ? 'caution' : 'recommended',
    note: warning,
  }
}

export function listModelChoices(config: OrcaConfig, currentModel?: string): ModelChoice[] {
  const choices: ModelChoice[] = []
  const seen = new Set<string>()

  for (const provider of listProviders(config)) {
    const providerConfig = config.providers[provider.id]
    const models = providerConfig?.models && providerConfig.models.length > 0
      ? providerConfig.models
      : provider.model && provider.model !== '(not set)'
        ? [provider.model]
        : []

    for (const model of models) {
      const key = `${provider.id}:${model}`
      if (seen.has(key)) continue
      seen.add(key)
      choices.push(getModelChoice(model, provider.id))
    }
  }

  for (const fallback of DEFAULT_MODELS) {
    const key = `${fallback.provider}:${fallback.model}`
    if (seen.has(key)) continue
    seen.add(key)
    choices.push(getModelChoice(fallback.model, fallback.provider))
  }

  if (currentModel) {
    const currentKey = choices.find((choice) => choice.model === currentModel)
    if (!currentKey) {
      choices.unshift(getModelChoice(currentModel, 'current'))
    }
  }

  return choices
}

export function formatContextWindow(window?: number): string {
  if (!window) return '?'
  if (window >= 1_000_000) return `${(window / 1_000_000).toFixed(window % 1_000_000 === 0 ? 0 : 1)}M`
  if (window >= 1_000) return `${Math.round(window / 1_000)}K`
  return String(window)
}

export function formatPricing(pricing?: [number, number]): string {
  if (!pricing) return '?'
  const [input, output] = pricing
  return `$${input}/$${output}`
}
