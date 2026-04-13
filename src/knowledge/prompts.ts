/**
 * Prompt Repository — versioned prompt templates with tracking.
 *
 * Stores reusable prompt patterns that have proven effective.
 * Tracks usage count and success rate for prompt evolution.
 *
 * Storage: ~/.orca/knowledge/prompts/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface PromptTemplate {
  id: string
  name: string
  template: string          // prompt text with {{variable}} placeholders
  category: string          // e.g., "code-review", "refactor", "debug", "explain"
  variables: string[]       // list of placeholder names
  usageCount: number
  successCount: number      // user-confirmed successes
  createdAt: string
  updatedAt: string
}

export class PromptRepository {
  private dir: string

  constructor() {
    const home = process.env.ORCA_HOME || process.env.HOME || homedir()
    this.dir = join(home, '.orca', 'knowledge', 'prompts')
    mkdirSync(this.dir, { recursive: true })
  }

  getDir(): string { return this.dir }

  /** Save a new prompt template */
  save(name: string, template: string, category: string): PromptTemplate {
    const id = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const variables = [...template.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]!)
    const pt: PromptTemplate = {
      id,
      name,
      template,
      category,
      variables,
      usageCount: 0,
      successCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(pt, null, 2))
    return pt
  }

  /** Load a prompt template by id */
  load(id: string): PromptTemplate | null {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  }

  /** Find prompts by name or category */
  find(query: string): PromptTemplate[] {
    const lower = query.toLowerCase()
    return this.listAll().filter(p =>
      p.name.toLowerCase().includes(lower) ||
      p.category.toLowerCase().includes(lower) ||
      p.template.toLowerCase().includes(lower)
    )
  }

  /** Apply a template with variable substitution */
  apply(id: string, vars: Record<string, string>): string | null {
    const pt = this.load(id)
    if (!pt) return null
    let result = pt.template
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    // Track usage
    pt.usageCount++
    pt.updatedAt = new Date().toISOString()
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(pt, null, 2))
    return result
  }

  /** Mark a prompt use as successful */
  markSuccess(id: string): void {
    const pt = this.load(id)
    if (!pt) return
    pt.successCount++
    pt.updatedAt = new Date().toISOString()
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(pt, null, 2))
  }

  /** List all prompts sorted by effectiveness (success rate) */
  listAll(): PromptTemplate[] {
    const files = readdirSync(this.dir).filter(f => f.endsWith('.json'))
    const results: PromptTemplate[] = []
    for (const file of files) {
      try {
        results.push(JSON.parse(readFileSync(join(this.dir, file), 'utf-8')))
      } catch { /* skip */ }
    }
    return results.sort((a, b) => {
      const rateA = a.usageCount > 0 ? a.successCount / a.usageCount : 0
      const rateB = b.usageCount > 0 ? b.successCount / b.usageCount : 0
      return rateB - rateA
    })
  }

  /** List recent prompts with limit */
  list(limit = 20): PromptTemplate[] {
    return this.listAll().slice(0, limit)
  }
}
