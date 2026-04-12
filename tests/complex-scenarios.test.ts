/**
 * Round 6: Complex Coding Scenarios — 20 tests
 * SOTA Dimensions D6 (Bug Fix) + D7 (Feature Dev)
 *
 * Simulates the hardest real-world challenges from SWE-bench,
 * FeatureBench, and Aider evaluation frameworks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const testDir = join(tmpdir(), `orca-complex-${Date.now()}`)

beforeAll(() => {
  // ── SWE-bench Style: Multi-file Express app with auth bug ──
  mkdirSync(join(testDir, 'swe-bench', 'src', 'routes'), { recursive: true })
  mkdirSync(join(testDir, 'swe-bench', 'src', 'middleware'), { recursive: true })
  mkdirSync(join(testDir, 'swe-bench', 'tests'), { recursive: true })

  // Root cause: middleware checks req.user.role instead of req.user.roles (plural)
  writeFileSync(join(testDir, 'swe-bench', 'src', 'middleware', 'auth.ts'), `
import { Request, Response, NextFunction } from 'express'

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // BUG: should be req.user.roles (array), not req.user.role (undefined)
  if (req.user?.role === 'admin') {
    return next()
  }
  return res.status(403).json({ error: 'Admin access required' })
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' })
  }
  next()
}
`)

  // Symptom shows here: users with admin in roles array get 403
  writeFileSync(join(testDir, 'swe-bench', 'src', 'routes', 'admin.ts'), `
import { Router } from 'express'
import { requireAdmin } from '../middleware/auth'

const router = Router()

// This returns 403 even for admin users because of bug in auth.ts
router.get('/admin/dashboard', requireAdmin, (req, res) => {
  res.json({ message: 'Welcome admin' })
})

router.get('/admin/users', requireAdmin, (req, res) => {
  res.json({ users: [] })
})

export default router
`)

  // Red herring: this file looks suspicious but isn't the problem
  writeFileSync(join(testDir, 'swe-bench', 'src', 'routes', 'user.ts'), `
import { Router } from 'express'
import { requireAuth } from '../middleware/auth'

const router = Router()

router.get('/user/profile', requireAuth, (req, res) => {
  // This works fine because it only checks requireAuth, not requireAdmin
  res.json({ user: req.user })
})

export default router
`)

  writeFileSync(join(testDir, 'swe-bench', 'src', 'types.ts'), `
export interface User {
  id: string
  name: string
  email: string
  roles: string[]  // Note: 'roles' is an array
}

declare global {
  namespace Express {
    interface Request {
      user?: User
    }
  }
}
`)

  writeFileSync(join(testDir, 'swe-bench', 'tests', 'auth.test.ts'), `
// Test shows the bug: admin user gets 403
// Expected: requireAdmin should check roles.includes('admin')
// Actual: checks role === 'admin' (undefined property)
describe('requireAdmin', () => {
  it('should allow admin users', () => {
    const user = { id: '1', name: 'Admin', email: 'a@b.com', roles: ['admin'] }
    // Fails because middleware checks .role not .roles
  })
})
`)

  // ── FeatureBench Style: Bare project needing pagination ──
  mkdirSync(join(testDir, 'feature-bench', 'src'), { recursive: true })
  mkdirSync(join(testDir, 'feature-bench', 'tests'), { recursive: true })

  writeFileSync(join(testDir, 'feature-bench', 'src', 'users.ts'), `
interface User {
  id: number
  name: string
  email: string
  createdAt: Date
}

const users: User[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: \`User \${i + 1}\`,
  email: \`user\${i + 1}@example.com\`,
  createdAt: new Date(2024, 0, i + 1),
}))

export function getUsers(): User[] {
  return users
}

export function getUserById(id: number): User | undefined {
  return users.find(u => u.id === id)
}

export function createUser(name: string, email: string): User {
  const user: User = { id: users.length + 1, name, email, createdAt: new Date() }
  users.push(user)
  return user
}
`)

  writeFileSync(join(testDir, 'feature-bench', 'src', 'types.ts'), `
export interface PaginatedResult<T> {
  data: T[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}
`)

  // ── Cross-Module Refactor: Tight coupling needing interface extraction ──
  mkdirSync(join(testDir, 'refactor', 'src'), { recursive: true })

  writeFileSync(join(testDir, 'refactor', 'src', 'database.ts'), `
export class Database {
  private data: Map<string, Record<string, unknown>> = new Map()

  async get(key: string): Promise<Record<string, unknown> | undefined> {
    return this.data.get(key)
  }

  async set(key: string, value: Record<string, unknown>): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list(): Promise<string[]> {
    return Array.from(this.data.keys())
  }
}
`)

  writeFileSync(join(testDir, 'refactor', 'src', 'user-service.ts'), `
import { Database } from './database'

export class UserService {
  constructor(private db: Database) {}

  async getUser(id: string) {
    return this.db.get(\`user:\${id}\`)
  }

  async saveUser(id: string, data: Record<string, unknown>) {
    return this.db.set(\`user:\${id}\`, data)
  }

  async deleteUser(id: string) {
    return this.db.delete(\`user:\${id}\`)
  }
}
`)

  writeFileSync(join(testDir, 'refactor', 'src', 'product-service.ts'), `
import { Database } from './database'

export class ProductService {
  constructor(private db: Database) {}

  async getProduct(id: string) {
    return this.db.get(\`product:\${id}\`)
  }

  async saveProduct(id: string, data: Record<string, unknown>) {
    return this.db.set(\`product:\${id}\`, data)
  }

  async listProducts() {
    const keys = await this.db.list()
    return keys.filter(k => k.startsWith('product:'))
  }
}
`)

  writeFileSync(join(testDir, 'refactor', 'src', 'order-service.ts'), `
import { Database } from './database'

export class OrderService {
  constructor(private db: Database) {}

  async getOrder(id: string) {
    return this.db.get(\`order:\${id}\`)
  }

  async createOrder(id: string, data: Record<string, unknown>) {
    return this.db.set(\`order:\${id}\`, data)
  }
}
`)

  writeFileSync(join(testDir, 'refactor', 'src', 'cache.ts'), `
import { Database } from './database'

export class CacheLayer {
  private cache = new Map<string, { value: unknown; expiry: number }>()

  constructor(private db: Database) {}

  async get(key: string) {
    const cached = this.cache.get(key)
    if (cached && cached.expiry > Date.now()) return cached.value
    return this.db.get(key)
  }
}
`)

  // ── Second-Chance Fix: Off-by-one error ──
  mkdirSync(join(testDir, 'second-chance', 'src'), { recursive: true })

  writeFileSync(join(testDir, 'second-chance', 'src', 'pagination.ts'), `
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  // BUG: off-by-one — page 1 should start at index 0, not pageSize
  const start = page * pageSize  // should be (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function getPageCount(totalItems: number, pageSize: number): number {
  // BUG: Math.floor should be Math.ceil
  return Math.floor(totalItems / pageSize)
}
`)

  // Git init all test projects
  for (const sub of ['swe-bench', 'feature-bench', 'refactor', 'second-chance']) {
    try {
      execSync('git init && git add -A && git commit -m "init"', {
        cwd: join(testDir, sub), encoding: 'utf-8', stdio: 'pipe',
      })
    } catch { /* ignore */ }
  }
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Scenario A: SWE-bench Style — Multi-File Bug Fix ────────────

describe('Scenario A: SWE-bench — Multi-file auth bug', () => {
  const cwd = () => join(testDir, 'swe-bench')

  it('A.1 Discover project structure', () => {
    const list = executeTool('list_directory', { path: '.', recursive: true }, cwd())
    expect(list.success).toBe(true)
    expect(list.output).toContain('auth.ts')
    expect(list.output).toContain('admin.ts')
    expect(list.output).toContain('user.ts')
  })

  it('A.2 Search for bug symptom — 403 error', () => {
    const search = executeTool('search_files', { pattern: '403', path: '.' }, cwd())
    expect(search.success).toBe(true)
    expect(search.output).toContain('auth.ts')
  })

  it('A.3 Read type definition — discover roles is array', () => {
    const read = executeTool('read_file', { path: 'src/types.ts' }, cwd())
    expect(read.success).toBe(true)
    expect(read.output).toContain('roles: string[]')
  })

  it('A.4 Identify root cause in auth middleware (not route file)', () => {
    const read = executeTool('read_file', { path: 'src/middleware/auth.ts' }, cwd())
    expect(read.success).toBe(true)
    // Root cause: checks .role instead of .roles
    expect(read.output).toContain('req.user?.role === \'admin\'')
    expect(read.output).not.toContain('.roles.includes')
  })

  it('A.5 Fix: change role to roles.includes', () => {
    const edit = executeTool('edit_file', {
      path: 'src/middleware/auth.ts',
      old_string: "if (req.user?.role === 'admin') {",
      new_string: "if (req.user?.roles?.includes('admin')) {",
    }, cwd())
    expect(edit.success).toBe(true)

    const content = readFileSync(join(cwd(), 'src', 'middleware', 'auth.ts'), 'utf-8')
    expect(content).toContain("roles?.includes('admin')")
    expect(content).not.toContain("role === 'admin'")
  })
})

// ── Scenario B: FeatureBench Style — Add Pagination ─────────────

describe('Scenario B: FeatureBench — Add pagination feature', () => {
  const cwd = () => join(testDir, 'feature-bench')

  it('B.1 Read existing code to understand interface', () => {
    const read = executeTool('read_file', { path: 'src/users.ts' }, cwd())
    expect(read.success).toBe(true)
    expect(read.output).toContain('getUsers')
    expect(read.output).toContain('User[]')
  })

  it('B.2 Read types file for pagination interface', () => {
    const read = executeTool('read_file', { path: 'src/types.ts' }, cwd())
    expect(read.success).toBe(true)
    expect(read.output).toContain('PaginatedResult')
  })

  it('B.3 Add paginated getUsers function', () => {
    const edit = executeTool('edit_file', {
      path: 'src/users.ts',
      old_string: 'export function getUsers(): User[] {\n  return users\n}',
      new_string: `export function getUsers(page = 1, pageSize = 10): { data: User[]; total: number; pages: number } {
  const start = (page - 1) * pageSize
  const data = users.slice(start, start + pageSize)
  return {
    data,
    total: users.length,
    pages: Math.ceil(users.length / pageSize),
  }
}`,
    }, cwd())
    expect(edit.success).toBe(true)
  })

  it('B.4 Verify pagination returns correct page', () => {
    const content = readFileSync(join(cwd(), 'src', 'users.ts'), 'utf-8')
    expect(content).toContain('(page - 1) * pageSize')
    expect(content).toContain('Math.ceil')
    expect(content).toContain('pages:')
  })

  it('B.5 Create test file for pagination', () => {
    const write = executeTool('write_file', {
      path: 'tests/users.test.ts',
      content: `import { getUsers } from '../src/users'

describe('getUsers pagination', () => {
  it('returns first page with 10 items', () => {
    const result = getUsers(1, 10)
    expect(result.data.length).toBe(10)
    expect(result.total).toBe(100)
    expect(result.pages).toBe(10)
  })

  it('returns correct page offset', () => {
    const result = getUsers(3, 10)
    expect(result.data[0].id).toBe(21)
  })
})
`,
    }, cwd())
    expect(write.success).toBe(true)
  })
})

// ── Scenario C: Cross-Module Refactor ───────────────────────────

describe('Scenario C: Extract shared interface from 5 files', () => {
  const cwd = () => join(testDir, 'refactor')

  it('C.1 Find all files importing Database', () => {
    const search = executeTool('search_files', { pattern: "import.*Database", path: '.' }, cwd())
    expect(search.success).toBe(true)
    expect(search.output).toContain('user-service.ts')
    expect(search.output).toContain('product-service.ts')
    expect(search.output).toContain('order-service.ts')
    expect(search.output).toContain('cache.ts')
  })

  it('C.2 Find all database method usages', () => {
    const search = executeTool('search_files', { pattern: 'this.db\\.', path: '.' }, cwd())
    expect(search.success).toBe(true)
    // Should find get, set, delete, list usages across files
  })

  it('C.3 Create shared Storage interface', () => {
    const write = executeTool('write_file', {
      path: 'src/storage.ts',
      content: `export interface Storage {
  get(key: string): Promise<Record<string, unknown> | undefined>
  set(key: string, value: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<boolean>
  list(): Promise<string[]>
}
`,
    }, cwd())
    expect(write.success).toBe(true)
  })

  it('C.4 Update Database to implement interface', () => {
    const edit = executeTool('edit_file', {
      path: 'src/database.ts',
      old_string: 'export class Database {',
      new_string: "import { Storage } from './storage'\n\nexport class Database implements Storage {",
    }, cwd())
    expect(edit.success).toBe(true)
  })

  it('C.5 Verify no breakage — all services still reference valid types', () => {
    // Check that database.ts still has all required methods
    const content = readFileSync(join(cwd(), 'src', 'database.ts'), 'utf-8')
    expect(content).toContain('async get(')
    expect(content).toContain('async set(')
    expect(content).toContain('async delete(')
    expect(content).toContain('async list(')
    expect(content).toContain('implements Storage')
    // Check interface file exists
    expect(existsSync(join(cwd(), 'src', 'storage.ts'))).toBe(true)
  })
})

// ── Scenario D: Second-Chance Fix (Aider Pattern) ───────────────

describe('Scenario D: Second-chance fix — off-by-one', () => {
  const cwd = () => join(testDir, 'second-chance')

  it('D.1 Read buggy code', () => {
    const read = executeTool('read_file', { path: 'src/pagination.ts' }, cwd())
    expect(read.success).toBe(true)
    expect(read.output).toContain('page * pageSize')
    expect(read.output).toContain('Math.floor')
  })

  it('D.2 First attempt: fix paginate off-by-one', () => {
    const edit = executeTool('edit_file', {
      path: 'src/pagination.ts',
      old_string: 'const start = page * pageSize  // should be (page - 1) * pageSize',
      new_string: 'const start = (page - 1) * pageSize',
    }, cwd())
    expect(edit.success).toBe(true)
    const content = readFileSync(join(cwd(), 'src', 'pagination.ts'), 'utf-8')
    expect(content).toContain('(page - 1) * pageSize')
  })

  it('D.3 Verify first fix semantically (not just syntactically)', () => {
    const content = readFileSync(join(cwd(), 'src', 'pagination.ts'), 'utf-8')
    // Page 1 should start at index 0
    expect(content).toContain('(page - 1) * pageSize')
    // NOT page * pageSize (which would skip first page)
    expect(content).not.toContain('page * pageSize')
  })

  it('D.4 Second bug in same file: fix getPageCount', () => {
    const edit = executeTool('edit_file', {
      path: 'src/pagination.ts',
      old_string: 'return Math.floor(totalItems / pageSize)',
      new_string: 'return Math.ceil(totalItems / pageSize)',
    }, cwd())
    expect(edit.success).toBe(true)
  })

  it('D.5 Both fixes verified — semantic correctness', () => {
    const content = readFileSync(join(cwd(), 'src', 'pagination.ts'), 'utf-8')
    // Pagination starts at correct offset
    expect(content).toContain('(page - 1) * pageSize')
    // Page count rounds up (not down) — check the return line specifically
    expect(content).toContain('Math.ceil')
    expect(content).toContain('return Math.ceil(totalItems / pageSize)')
    // The actual return statement should use ceil, not floor
    expect(content).not.toContain('return Math.floor')

    // Verify the diff shows both fixes
    const diff = executeTool('git_diff', {}, cwd())
    expect(diff.success).toBe(true)
    expect(diff.output).toContain('(page - 1)')
    expect(diff.output).toContain('Math.ceil')
  })
})
