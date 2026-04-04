/**
 * Round 2: Integration scenarios — simulating real coding workflows.
 * Tests multi-step tool chains that a coding agent would perform.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const testDir = join(tmpdir(), `forge-integ-${Date.now()}`)

beforeAll(() => {
  mkdirSync(join(testDir, 'src'), { recursive: true })
  mkdirSync(join(testDir, 'tests'), { recursive: true })

  // Create a buggy project for the agent to fix
  writeFileSync(join(testDir, 'src', 'api.ts'), `
import { db } from './db'

export async function getUser(id: string) {
  const user = await db.query('SELECT * FROM users WHERE id = ' + id)
  return user[0]
}

export async function createUser(name: string, email: string) {
  await db.query(\`INSERT INTO users (name, email) VALUES ('\${name}', '\${email}')\`)
  return { name, email }
}

export async function deleteUser(id: string) {
  await db.query('DELETE FROM users WHERE id = ' + id)
}
`)

  writeFileSync(join(testDir, 'src', 'db.ts'), `
export const db = {
  async query(sql: string) {
    console.log('executing:', sql)
    return []
  }
}
`)

  writeFileSync(join(testDir, 'src', 'config.ts'), `
export const config = {
  port: 3000,
  host: 'localhost',
  dbUrl: 'postgres://localhost/myapp',
  secret: 'hardcoded-secret-key',
}
`)

  // Git init
  try {
    execSync('git init && git add -A && git commit -m "init: buggy project"', {
      cwd: testDir, encoding: 'utf-8', stdio: 'pipe',
    })
  } catch { /* ignore */ }
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Scenario 1: Bug Investigation ────────────────────────────────

describe('Scenario: Bug investigation workflow', () => {
  it('step 1: explore project structure', () => {
    const list = executeTool('list_directory', { path: '.', recursive: true }, testDir)
    expect(list.success).toBe(true)
    expect(list.output).toContain('api.ts')
    expect(list.output).toContain('db.ts')
  })

  it('step 2: search for SQL injection pattern', () => {
    const search = executeTool('search_files', { pattern: 'WHERE id', path: '.' }, testDir)
    expect(search.success).toBe(true)
    expect(search.output).toContain('api.ts')
  })

  it('step 3: read the vulnerable file', () => {
    const read = executeTool('read_file', { path: 'src/api.ts' }, testDir)
    expect(read.success).toBe(true)
    expect(read.output).toContain("'SELECT * FROM users WHERE id = ' + id")
  })

  it('step 4: fix SQL injection with parameterized query', () => {
    const edit = executeTool('edit_file', {
      path: 'src/api.ts',
      old_string: "const user = await db.query('SELECT * FROM users WHERE id = ' + id)\n  return user[0]",
      new_string: "const user = await db.query('SELECT * FROM users WHERE id = $1', [id])\n  return user[0]",
    }, testDir)
    expect(edit.success).toBe(true)
    const content = readFileSync(join(testDir, 'src', 'api.ts'), 'utf-8')
    expect(content).toContain('$1')
  })

  it('step 5: verify fix with git diff', () => {
    const diff = executeTool('git_diff', {}, testDir)
    expect(diff.success).toBe(true)
    expect(diff.output).toContain('$1')
  })
})

// ── Scenario 2: Multi-file Refactoring ───────────────────────────

describe('Scenario: Multi-file refactoring', () => {
  it('step 1: find all db.query usages', () => {
    const refs = executeTool('find_references', { name: 'db.query', path: '.' }, testDir)
    expect(refs.success).toBe(true)
  })

  it('step 2: fix createUser SQL injection', () => {
    const edit = executeTool('edit_file', {
      path: 'src/api.ts',
      old_string: "await db.query(`INSERT INTO users (name, email) VALUES ('${name}', '${email}')`)",
      new_string: "await db.query('INSERT INTO users (name, email) VALUES ($1, $2)', [name, email])",
    }, testDir)
    expect(edit.success).toBe(true)
  })

  it('step 3: fix deleteUser SQL injection', () => {
    const edit = executeTool('edit_file', {
      path: 'src/api.ts',
      old_string: "await db.query('DELETE FROM users WHERE id = ' + id)",
      new_string: "await db.query('DELETE FROM users WHERE id = $1', [id])",
    }, testDir)
    expect(edit.success).toBe(true)
  })

  it('step 4: verify all injections fixed', () => {
    const content = readFileSync(join(testDir, 'src', 'api.ts'), 'utf-8')
    expect(content).not.toContain("' + id")
    expect(content).not.toContain("${name}")
    expect(content).toContain('$1')
    expect(content).toContain('$2')
  })

  it('step 5: check for hardcoded secrets', () => {
    const search = executeTool('search_files', { pattern: 'hardcoded-secret', path: '.' }, testDir)
    expect(search.success).toBe(true)
    expect(search.output).toContain('config.ts')
  })

  it('step 6: fix hardcoded secret', () => {
    const edit = executeTool('edit_file', {
      path: 'src/config.ts',
      old_string: "secret: 'hardcoded-secret-key'",
      new_string: "secret: process.env.APP_SECRET || ''",
    }, testDir)
    expect(edit.success).toBe(true)
  })
})

// ── Scenario 3: New Feature Development ──────────────────────────

describe('Scenario: New feature — add middleware', () => {
  it('step 1: create new file', () => {
    const write = executeTool('write_file', {
      path: 'src/middleware.ts',
      content: `
import { config } from './config'

export function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }
  try {
    // TODO: verify JWT
    next()
  } catch {
    res.status(403).json({ error: 'Invalid token' })
  }
}

export function rateLimiter(maxRequests = 100) {
  const requests = new Map<string, number>()
  return (req: any, res: any, next: any) => {
    const ip = req.ip
    const count = (requests.get(ip) || 0) + 1
    requests.set(ip, count)
    if (count > maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' })
    }
    next()
  }
}
`,
    }, testDir)
    expect(write.success).toBe(true)
    expect(write.output).toContain('Created')
  })

  it('step 2: verify file was created', () => {
    const read = executeTool('read_file', { path: 'src/middleware.ts' }, testDir)
    expect(read.success).toBe(true)
    expect(read.output).toContain('authMiddleware')
    expect(read.output).toContain('rateLimiter')
  })

  it('step 3: find definition of new function', () => {
    const def = executeTool('find_definition', { name: 'rateLimiter', path: '.' }, testDir)
    expect(def.success).toBe(true)
    expect(def.output).toContain('middleware.ts')
  })

  it('step 4: get file info', () => {
    const info = executeTool('file_info', { path: 'src/middleware.ts' }, testDir)
    expect(info.success).toBe(true)
    expect(info.output).toContain('type: file')
  })

  it('step 5: count project lines', () => {
    const lines = executeTool('count_lines', { path: '.' }, testDir)
    expect(lines.success).toBe(true)
  })
})

// ── Scenario 4: Task Tracking ────────────────────────────────────

describe('Scenario: Task-driven development', () => {
  it('create tasks, update progress, verify completion', () => {
    // Create tasks
    const t1 = executeTool('task_create', { title: 'Fix SQL injection', description: 'Parameterize all queries' }, testDir)
    const t2 = executeTool('task_create', { title: 'Remove hardcoded secrets' }, testDir)
    const t3 = executeTool('task_create', { title: 'Add auth middleware' }, testDir)

    const id1 = t1.output.match(/task-\d+/)?.[0]!
    const id2 = t2.output.match(/task-\d+/)?.[0]!
    const id3 = t3.output.match(/task-\d+/)?.[0]!

    // Update status as work progresses
    executeTool('task_update', { id: id1, status: 'completed' }, testDir)
    executeTool('task_update', { id: id2, status: 'completed' }, testDir)
    executeTool('task_update', { id: id3, status: 'in_progress' }, testDir)

    // Verify
    const list = executeTool('task_list', {}, testDir)
    expect(list.output).toContain('✓')  // completed
    expect(list.output).toContain('●')  // in_progress
  })
})

// ── Scenario 5: Plan + Verify ────────────────────────────────────

describe('Scenario: Plan execution and verification', () => {
  it('create plan and verify each step', () => {
    const plan = executeTool('create_plan', {
      goal: 'Secure the application',
      steps: [
        'Fix SQL injection in api.ts',
        'Remove hardcoded secret in config.ts',
        'Add authentication middleware',
      ],
    }, testDir)
    expect(plan.success).toBe(true)

    // Verify the steps were done
    const verify = executeTool('verify_plan', {
      checks: [
        'grep -q "\\$1" src/api.ts',                    // parameterized queries
        'grep -q "process.env" src/config.ts',           // env-based secret
        'test -f src/middleware.ts',                      // middleware exists
      ],
    }, testDir)
    expect(verify.success).toBe(true)
    expect(verify.output).not.toContain('✗')
  })
})
