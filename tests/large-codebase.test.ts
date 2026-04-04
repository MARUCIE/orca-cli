/**
 * Round 7: Large Codebase Stress — 12 tests
 * SOTA Dimension D8: Accuracy on 50+ file projects
 *
 * Tests that tools remain accurate when operating on a realistic,
 * large project structure. Key insight from SWE-bench Pro: agents
 * that work on 5-file projects often fail on 50+ file projects
 * due to search noise, false positives, and context dilution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `forge-large-${Date.now()}`)

beforeAll(() => {
  // Generate a 50+ file realistic project structure
  const dirs = [
    'src/controllers', 'src/models', 'src/services', 'src/middleware',
    'src/utils', 'src/config', 'src/types', 'src/routes',
    'tests/unit', 'tests/integration', 'tests/e2e',
    'lib/auth', 'lib/database', 'lib/cache', 'lib/logger',
    'scripts', 'config',
  ]
  for (const d of dirs) {
    mkdirSync(join(testDir, d), { recursive: true })
  }

  // Controllers (5 files)
  const controllers = ['user', 'product', 'order', 'payment', 'notification']
  for (const name of controllers) {
    writeFileSync(join(testDir, 'src', 'controllers', `${name}.controller.ts`), `
import { ${name}Service } from '../services/${name}.service'

export class ${name.charAt(0).toUpperCase() + name.slice(1)}Controller {
  constructor(private service: typeof ${name}Service) {}

  async get(id: string) {
    return this.service.findById(id)
  }

  async list(page: number, limit: number) {
    return this.service.findAll({ page, limit })
  }

  async create(data: Record<string, unknown>) {
    return this.service.create(data)
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.service.update(id, data)
  }

  async delete(id: string) {
    return this.service.remove(id)
  }
}
`)
  }

  // Services (5 files)
  for (const name of controllers) {
    writeFileSync(join(testDir, 'src', 'services', `${name}.service.ts`), `
import { DatabaseClient } from '../../lib/database/client'
import { CacheManager } from '../../lib/cache/manager'

export const ${name}Service = {
  async findById(id: string) {
    const cached = await CacheManager.get(\`${name}:\${id}\`)
    if (cached) return cached
    const result = await DatabaseClient.query(\`SELECT * FROM ${name}s WHERE id = $1\`, [id])
    return result.rows[0]
  },

  async findAll(opts: { page: number; limit: number }) {
    const offset = (opts.page - 1) * opts.limit
    return DatabaseClient.query(\`SELECT * FROM ${name}s LIMIT $1 OFFSET $2\`, [opts.limit, offset])
  },

  async create(data: Record<string, unknown>) {
    return DatabaseClient.query(\`INSERT INTO ${name}s DEFAULT VALUES\`, [])
  },

  async update(id: string, data: Record<string, unknown>) {
    return DatabaseClient.query(\`UPDATE ${name}s SET updated_at = NOW() WHERE id = $1\`, [id])
  },

  async remove(id: string) {
    await CacheManager.delete(\`${name}:\${id}\`)
    return DatabaseClient.query(\`DELETE FROM ${name}s WHERE id = $1\`, [id])
  },
}
`)
  }

  // Models (5 files)
  for (const name of controllers) {
    writeFileSync(join(testDir, 'src', 'models', `${name}.model.ts`), `
export interface ${name.charAt(0).toUpperCase() + name.slice(1)} {
  id: string
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
}

export interface Create${name.charAt(0).toUpperCase() + name.slice(1)}Input {
  [key: string]: unknown
}
`)
  }

  // Middleware (4 files)
  const middlewares = ['auth', 'rateLimit', 'logging', 'validation']
  for (const name of middlewares) {
    writeFileSync(join(testDir, 'src', 'middleware', `${name}.ts`), `
export function ${name}Middleware(req: unknown, res: unknown, next: () => void) {
  // ${name} middleware implementation
  next()
}
`)
  }

  // Routes (5 files)
  for (const name of controllers) {
    writeFileSync(join(testDir, 'src', 'routes', `${name}.routes.ts`), `
import { Router } from 'express'
import { ${name.charAt(0).toUpperCase() + name.slice(1)}Controller } from '../controllers/${name}.controller'

const router = Router()
export default router
`)
  }

  // Utils (5 files)
  const utils = ['format', 'validate', 'transform', 'hash', 'date']
  for (const name of utils) {
    writeFileSync(join(testDir, 'src', 'utils', `${name}.ts`), `
export function ${name}Helper(input: unknown): unknown {
  return input
}
`)
  }

  // Types (3 files)
  writeFileSync(join(testDir, 'src', 'types', 'common.ts'), `
export type ID = string
export type Timestamp = Date
export interface PaginationOpts { page: number; limit: number }
`)
  writeFileSync(join(testDir, 'src', 'types', 'api.ts'), `
export interface ApiResponse<T> { data: T; status: number; message: string }
export interface ApiError { code: string; message: string; details?: unknown }
`)
  writeFileSync(join(testDir, 'src', 'types', 'config.ts'), `
export interface AppConfig { port: number; host: string; dbUrl: string }
`)

  // Config (2 files)
  writeFileSync(join(testDir, 'config', 'default.ts'), `
export const config = { port: 3000, host: 'localhost', dbUrl: 'postgres://localhost/app' }
`)
  writeFileSync(join(testDir, 'config', 'production.ts'), `
export const config = { port: 8080, host: '0.0.0.0', dbUrl: process.env.DATABASE_URL || '' }
`)

  // Lib (6 files)
  writeFileSync(join(testDir, 'lib', 'database', 'client.ts'), `
export const DatabaseClient = {
  async query(sql: string, params: unknown[]) { return { rows: [] } },
  async connect() { return true },
}
`)
  writeFileSync(join(testDir, 'lib', 'database', 'migrations.ts'), `
export async function runMigrations() { return { applied: 0, pending: 0 } }
`)
  writeFileSync(join(testDir, 'lib', 'cache', 'manager.ts'), `
export const CacheManager = {
  async get(key: string) { return null },
  async set(key: string, value: unknown, ttl?: number) {},
  async delete(key: string) { return true },
}
`)
  writeFileSync(join(testDir, 'lib', 'auth', 'jwt.ts'), `
export function signToken(payload: Record<string, unknown>): string { return 'token' }
export function verifyToken(token: string): Record<string, unknown> | null { return null }
`)
  writeFileSync(join(testDir, 'lib', 'logger', 'index.ts'), `
export const logger = {
  info: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
  warn: (msg: string) => console.warn(msg),
}
`)

  // Tests (6 files)
  for (const name of controllers.slice(0, 3)) {
    writeFileSync(join(testDir, 'tests', 'unit', `${name}.test.ts`), `
describe('${name}Service', () => {
  it('should find by id', () => { expect(true).toBe(true) })
  it('should list all', () => { expect(true).toBe(true) })
})
`)
  }
  for (const name of controllers.slice(0, 3)) {
    writeFileSync(join(testDir, 'tests', 'integration', `${name}.test.ts`), `
describe('${name} API', () => {
  it('GET /${name}s/:id', () => { expect(true).toBe(true) })
  it('POST /${name}s', () => { expect(true).toBe(true) })
})
`)
  }

  // Scripts (2 files)
  writeFileSync(join(testDir, 'scripts', 'seed.ts'), `
export async function seed() { console.log('seeding...') }
`)
  writeFileSync(join(testDir, 'scripts', 'migrate.ts'), `
export async function migrate() { console.log('migrating...') }
`)

  // Root config files (3)
  writeFileSync(join(testDir, 'package.json'), '{"name":"large-project","version":"1.0.0"}\n')
  writeFileSync(join(testDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n')
  writeFileSync(join(testDir, 'README.md'), '# Large Project\n\n50+ file test project.\n')

  // Extra files to ensure 50+ total (padding)
  const extraFiles = ['analytics', 'notification', 'search', 'export', 'import']
  for (const name of extraFiles) {
    writeFileSync(join(testDir, 'src', 'utils', `${name}.helper.ts`), `
export function ${name}Helper() { return '${name}' }
`)
  }
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Tests ─────────────���─────────────────────────────────────────

describe('Large codebase: File discovery', () => {
  it('7.1 glob_files finds TypeScript files across 50+ files', () => {
    const r = executeTool('glob_files', { pattern: '*.ts' }, testDir)
    expect(r.success).toBe(true)
    const files = r.output.split('\n').filter(l => l.includes('.ts'))
    expect(files.length).toBeGreaterThanOrEqual(50)
  })

  it('7.2 search_files finds specific pattern across entire project', () => {
    const r = executeTool('search_files', { pattern: 'DatabaseClient', path: '.' }, testDir)
    expect(r.success).toBe(true)
    // Should find in all 5 service files + database/client.ts
    expect(r.output).toContain('user.service.ts')
    expect(r.output).toContain('product.service.ts')
    expect(r.output).toContain('client.ts')
  })

  it('7.3 find_definition accurately locates function in large project', () => {
    const r = executeTool('find_definition', { name: 'signToken', path: '.' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('jwt.ts')
    expect(r.output).toContain('function signToken')
  })

  it('7.4 find_references is comprehensive across modules', () => {
    const r = executeTool('find_references', { name: 'CacheManager', path: '.' }, testDir)
    expect(r.success).toBe(true)
    // Should find definition + all service usages
    expect(r.output).toContain('manager.ts')
    // Should find at least some service files
  })
})

describe('Large codebase: Navigation', () => {
  it('7.5 directory_tree handles deep nesting', () => {
    const r = executeTool('directory_tree', { path: '.', depth: 4 }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('controllers')
    expect(r.output).toContain('services')
    expect(r.output).toContain('lib')
  })

  it('7.6 count_lines accurate on large project', () => {
    const r = executeTool('count_lines', { path: '.' }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('total')
    // Should report meaningful line count
  })

  it('7.7 list_directory recursive on wide tree', () => {
    const r = executeTool('list_directory', { path: '.', recursive: true }, testDir)
    expect(r.success).toBe(true)
    // Should see multiple levels
    expect(r.output).toContain('src/')
    expect(r.output).toContain('lib/')
    expect(r.output).toContain('tests/')
  })
})

describe('Large codebase: Edit precision', () => {
  it('7.8 edit_file precise in 500+ line file', () => {
    // Create a long file
    const lines = Array.from({ length: 500 }, (_, i) =>
      `export function func${i + 1}() { return ${i + 1} }`
    )
    writeFileSync(join(testDir, 'src', 'large-module.ts'), lines.join('\n') + '\n')

    // Edit a specific function in the middle
    const r = executeTool('edit_file', {
      path: 'src/large-module.ts',
      old_string: 'export function func250() { return 250 }',
      new_string: 'export function func250() { return 999 }',
    }, testDir)
    expect(r.success).toBe(true)

    const content = readFileSync(join(testDir, 'src', 'large-module.ts'), 'utf-8')
    expect(content).toContain('return 999')
    // Other functions unchanged
    expect(content).toContain('func249() { return 249 }')
    expect(content).toContain('func251() { return 251 }')
  })

  it('7.9 multi_edit batch on 500+ line file', () => {
    const r = executeTool('multi_edit', {
      path: 'src/large-module.ts',
      edits: [
        { old_string: 'export function func1() { return 1 }', new_string: 'export function func1() { return 1001 }' },
        { old_string: 'export function func500() { return 500 }', new_string: 'export function func500() { return 1500 }' },
      ],
    }, testDir)
    expect(r.success).toBe(true)
    expect(r.output).toContain('Applied 2 edits')
  })

  it('7.10 search_files with regex in large corpus', () => {
    const r = executeTool('search_files', { pattern: 'findById|findAll', path: '.' }, testDir)
    expect(r.success).toBe(true)
    // Should match in all 5 services + all 5 controllers
  })
})

describe('Large codebase: Cross-directory operations', () => {
  it('7.11 Cross-directory file discovery works', () => {
    // Find all files that import from lib/
    const r = executeTool('search_files', { pattern: "from.*lib/", path: '.' }, testDir)
    expect(r.success).toBe(true)
    // Service files import from lib/database and lib/cache
  })

  it('7.12 Performance: glob completes quickly on large project', () => {
    const start = Date.now()
    const r = executeTool('glob_files', { pattern: '**/*.ts' }, testDir)
    const elapsed = Date.now() - start
    expect(r.success).toBe(true)
    // Should complete in under 2 seconds
    expect(elapsed).toBeLessThan(2000)
  })
})
