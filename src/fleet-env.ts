/**
 * fleet-env.ts — Read FLEET environment data from ~/.claude/settings.json
 *
 * Provides a one-line summary of the shared AI-Fleet infrastructure
 * (hooks, MCP servers, context files, skills) for startup banners.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'

export interface FleetEnv {
  hookTypes: number
  hookTotal: number
  mcpCount: number
  ctxMd: number
  ctxRules: number
  ctxMemory: number
  skills: number
}

export function getFleetEnv(): FleetEnv | null {
  try {
    const home = process.env.HOME || ''
    const settingsPath = join(home, '.claude', 'settings.json')
    if (!existsSync(settingsPath)) return null

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))

    // Hooks
    const hooks = settings.hooks || {}
    const hookTypes = Object.keys(hooks).length
    const hookTotal = Object.values(hooks).reduce((sum: number, arr: unknown) => {
      return sum + (Array.isArray(arr) ? arr.length : 0)
    }, 0) as number

    // MCP servers
    const mcpCount = Object.keys(settings.mcpServers || {}).length

    // Context: CLAUDE.md files
    let ctxMd = 0
    if (existsSync(join(home, 'CLAUDE.md'))) ctxMd++
    if (existsSync(join(home, '.claude', 'CLAUDE.md'))) ctxMd++

    // Context: rules
    let ctxRules = 0
    const rulesDir = join(home, '.claude', 'rules')
    if (existsSync(rulesDir)) {
      ctxRules = readdirSync(rulesDir).filter(f => f.endsWith('.md')).length
    }

    // Context: memory
    let ctxMemory = 0
    const memDir = join(home, '.claude', 'projects', '-Users-mauricewen', 'memory')
    if (existsSync(memDir)) {
      ctxMemory = readdirSync(memDir).filter(f => f.endsWith('.md')).length
    }

    // Skills
    let skills = 0
    const skillsDir = join(home, '.claude', 'skills')
    if (existsSync(skillsDir)) {
      skills = readdirSync(skillsDir).filter(d => {
        try { return existsSync(join(skillsDir, d, 'SKILL.md')) } catch { return false }
      }).length
    }

    return { hookTypes, hookTotal, mcpCount, ctxMd, ctxRules, ctxMemory, skills }
  } catch {
    return null
  }
}

/** One-line summary for banner display */
export function getFleetSummaryLine(): string | null {
  const env = getFleetEnv()
  if (!env) return null

  const parts: string[] = [
    `${env.hookTypes}\u00d7${env.hookTotal} hooks`,
    `${env.mcpCount} mcp`,
    `${env.skills} skills`,
    `${env.ctxMd}md+${env.ctxRules}r+${env.ctxMemory}m ctx`,
  ]
  return parts.join(' \u00B7 ')
}
