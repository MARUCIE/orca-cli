/**
 * Benchmark Scenarios — standardized coding tasks for agent evaluation.
 *
 * Each scenario defines:
 *   - setup(): create a project with a known problem
 *   - verify(): check if the agent solved it correctly
 *   - metadata: difficulty, category, expected tools
 *
 * Based on SWE-bench/FeatureBench/Aider evaluation patterns.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { executeTool } from '../tools.js'

// ── Types ────────────────────────────────────────────────────────

export interface BenchScenario {
  id: string
  name: string
  category: 'bug-fix' | 'feature-dev' | 'refactor' | 'navigation' | 'multi-step'
  difficulty: 'easy' | 'medium' | 'hard'
  /** Set up the project in the given directory */
  setup: (dir: string) => void
  /** Steps the agent should take (tool calls with args) */
  steps: Array<{ tool: string; args: Record<string, unknown> }>
  /** Verify the outcome — returns { passed, details } */
  verify: (dir: string) => { passed: boolean; details: string }
  /** Expected duration in ms (for timeout) */
  timeoutMs?: number
}

export interface BenchResult {
  scenario: string
  passed: boolean
  details: string
  stepsExecuted: number
  stepsFailed: number
  durationMs: number
  toolCalls: string[]
}

// ── Scenario Runner ─────────────────────────────────────────────

export function runScenario(scenario: BenchScenario, baseDir: string): BenchResult {
  const dir = join(baseDir, scenario.id)
  mkdirSync(dir, { recursive: true })

  const startTime = Date.now()
  const toolCalls: string[] = []
  let stepsFailed = 0

  // Setup
  scenario.setup(dir)

  // Execute steps
  for (const step of scenario.steps) {
    toolCalls.push(step.tool)
    const result = executeTool(step.tool, step.args, dir)
    if (!result.success) {
      stepsFailed++
    }
  }

  // Verify
  const verification = scenario.verify(dir)

  return {
    scenario: scenario.id,
    passed: verification.passed,
    details: verification.details,
    stepsExecuted: scenario.steps.length,
    stepsFailed,
    durationMs: Date.now() - startTime,
    toolCalls,
  }
}

// ── Built-in Scenarios ──────────────────────────────────────────

export const SCENARIOS: BenchScenario[] = [
  // ── S1: SQL Injection Fix (Easy, Bug Fix) ──
  {
    id: 's1-sql-injection',
    name: 'Fix SQL injection vulnerability',
    category: 'bug-fix',
    difficulty: 'easy',
    setup: (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'db.ts'), `
export async function getUser(id: string) {
  return db.query('SELECT * FROM users WHERE id = ' + id)
}

export async function deleteUser(id: string) {
  return db.query('DELETE FROM users WHERE id = ' + id)
}
`)
    },
    steps: [
      { tool: 'read_file', args: { path: 'src/db.ts' } },
      { tool: 'edit_file', args: {
        path: 'src/db.ts',
        old_string: "return db.query('SELECT * FROM users WHERE id = ' + id)",
        new_string: "return db.query('SELECT * FROM users WHERE id = $1', [id])",
      }},
      { tool: 'edit_file', args: {
        path: 'src/db.ts',
        old_string: "return db.query('DELETE FROM users WHERE id = ' + id)",
        new_string: "return db.query('DELETE FROM users WHERE id = $1', [id])",
      }},
    ],
    verify: (dir) => {
      const content = readFileSync(join(dir, 'src', 'db.ts'), 'utf-8')
      const hasParam = content.includes('$1')
      const noConcat = !content.includes("' + id")
      return {
        passed: hasParam && noConcat,
        details: hasParam && noConcat
          ? 'All SQL injections fixed with parameterized queries'
          : `Parameterized: ${hasParam}, No concat: ${noConcat}`,
      }
    },
  },

  // ── S2: Add Pagination (Medium, Feature Dev) ──
  {
    id: 's2-pagination',
    name: 'Add pagination to list endpoint',
    category: 'feature-dev',
    difficulty: 'medium',
    setup: (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'users.ts'), `
const users = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'User ' + (i + 1) }))

export function getUsers() {
  return users
}
`)
    },
    steps: [
      { tool: 'read_file', args: { path: 'src/users.ts' } },
      { tool: 'edit_file', args: {
        path: 'src/users.ts',
        old_string: 'export function getUsers() {\n  return users\n}',
        new_string: `export function getUsers(page = 1, pageSize = 10) {
  const start = (page - 1) * pageSize
  return {
    data: users.slice(start, start + pageSize),
    total: users.length,
    pages: Math.ceil(users.length / pageSize),
  }
}`,
      }},
    ],
    verify: (dir) => {
      const content = readFileSync(join(dir, 'src', 'users.ts'), 'utf-8')
      const hasPage = content.includes('page')
      const hasSlice = content.includes('slice')
      const hasCeil = content.includes('Math.ceil')
      const hasCorrectOffset = content.includes('(page - 1) * pageSize')
      return {
        passed: hasPage && hasSlice && hasCeil && hasCorrectOffset,
        details: `page: ${hasPage}, slice: ${hasSlice}, ceil: ${hasCeil}, offset: ${hasCorrectOffset}`,
      }
    },
  },

  // ── S3: Extract Interface (Medium, Refactor) ──
  {
    id: 's3-extract-interface',
    name: 'Extract shared interface from concrete class',
    category: 'refactor',
    difficulty: 'medium',
    setup: (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'database.ts'), `
export class Database {
  async get(key: string) { return null }
  async set(key: string, value: unknown) {}
  async delete(key: string) { return false }
}
`)
      writeFileSync(join(dir, 'src', 'service.ts'), `
import { Database } from './database'
export class UserService {
  constructor(private db: Database) {}
  async getUser(id: string) { return this.db.get(id) }
}
`)
    },
    steps: [
      { tool: 'read_file', args: { path: 'src/database.ts' } },
      { tool: 'write_file', args: {
        path: 'src/storage.ts',
        content: `export interface Storage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
}
`,
      }},
      { tool: 'edit_file', args: {
        path: 'src/database.ts',
        old_string: 'export class Database {',
        new_string: "import { Storage } from './storage'\n\nexport class Database implements Storage {",
      }},
    ],
    verify: (dir) => {
      const hasInterface = existsSync(join(dir, 'src', 'storage.ts'))
      const dbContent = readFileSync(join(dir, 'src', 'database.ts'), 'utf-8')
      const implementsStorage = dbContent.includes('implements Storage')
      const importsStorage = dbContent.includes("import { Storage }")
      return {
        passed: hasInterface && implementsStorage && importsStorage,
        details: `interface: ${hasInterface}, implements: ${implementsStorage}, imports: ${importsStorage}`,
      }
    },
  },

  // ── S4: Off-by-one Fix (Easy, Bug Fix) ──
  {
    id: 's4-off-by-one',
    name: 'Fix off-by-one in pagination',
    category: 'bug-fix',
    difficulty: 'easy',
    setup: (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'paginate.ts'), `
export function paginate<T>(items: T[], page: number, size: number): T[] {
  const start = page * size
  return items.slice(start, start + size)
}

export function pageCount(total: number, size: number): number {
  return Math.floor(total / size)
}
`)
    },
    steps: [
      { tool: 'read_file', args: { path: 'src/paginate.ts' } },
      { tool: 'edit_file', args: {
        path: 'src/paginate.ts',
        old_string: 'const start = page * size',
        new_string: 'const start = (page - 1) * size',
      }},
      { tool: 'edit_file', args: {
        path: 'src/paginate.ts',
        old_string: 'return Math.floor(total / size)',
        new_string: 'return Math.ceil(total / size)',
      }},
    ],
    verify: (dir) => {
      const content = readFileSync(join(dir, 'src', 'paginate.ts'), 'utf-8')
      const correctOffset = content.includes('(page - 1) * size')
      const correctCeil = content.includes('Math.ceil')
      const noFloor = !content.includes('return Math.floor')
      return {
        passed: correctOffset && correctCeil && noFloor,
        details: `offset: ${correctOffset}, ceil: ${correctCeil}, no floor: ${noFloor}`,
      }
    },
  },

  // ── S5: Large File Navigation (Hard, Navigation) ──
  {
    id: 's5-large-nav',
    name: 'Navigate and edit in large project',
    category: 'navigation',
    difficulty: 'hard',
    setup: (dir) => {
      // Create 30-file project
      const modules = ['auth', 'user', 'product', 'order', 'payment',
        'notification', 'analytics', 'search', 'cache', 'config']
      for (const mod of modules) {
        mkdirSync(join(dir, 'src', mod), { recursive: true })
        writeFileSync(join(dir, 'src', mod, 'index.ts'), `export class ${mod.charAt(0).toUpperCase() + mod.slice(1)}Module {}\n`)
        writeFileSync(join(dir, 'src', mod, 'service.ts'), `import { ${mod.charAt(0).toUpperCase() + mod.slice(1)}Module } from './index'\nexport const service = new ${mod.charAt(0).toUpperCase() + mod.slice(1)}Module()\n`)
        writeFileSync(join(dir, 'src', mod, 'types.ts'), `export interface ${mod.charAt(0).toUpperCase() + mod.slice(1)}Config { enabled: boolean }\n`)
      }
      // The target: find AuthModule and add a method
      writeFileSync(join(dir, 'src', 'auth', 'index.ts'),
        `export class AuthModule {\n  validate(token: string): boolean {\n    return token.length > 0\n  }\n}\n`)
    },
    steps: [
      { tool: 'glob_files', args: { pattern: '*.ts' } },
      { tool: 'search_files', args: { pattern: 'AuthModule', path: '.' } },
      { tool: 'read_file', args: { path: 'src/auth/index.ts' } },
      { tool: 'edit_file', args: {
        path: 'src/auth/index.ts',
        old_string: '  validate(token: string): boolean {\n    return token.length > 0\n  }\n}',
        new_string: '  validate(token: string): boolean {\n    return token.length > 0\n  }\n\n  refresh(token: string): string {\n    return `refreshed_${token}`\n  }\n}',
      }},
      { tool: 'find_definition', args: { name: 'AuthModule', path: '.' } },
    ],
    verify: (dir) => {
      const content = readFileSync(join(dir, 'src', 'auth', 'index.ts'), 'utf-8')
      const hasRefresh = content.includes('refresh(token: string)')
      const hasValidate = content.includes('validate(token: string)')
      return {
        passed: hasRefresh && hasValidate,
        details: `refresh added: ${hasRefresh}, validate preserved: ${hasValidate}`,
      }
    },
  },
]

// ── Suite Runner ─────────────────────────────────────────────────

export function runSuite(
  scenarios: BenchScenario[],
  baseDir: string,
  onResult?: (result: BenchResult) => void,
): { results: BenchResult[]; score: number; totalMs: number } {
  const results: BenchResult[] = []
  const startTime = Date.now()

  for (const scenario of scenarios) {
    const result = runScenario(scenario, baseDir)
    results.push(result)
    onResult?.(result)
  }

  const passed = results.filter(r => r.passed).length
  const score = Math.round((passed / results.length) * 100)

  return {
    results,
    score,
    totalMs: Date.now() - startTime,
  }
}
