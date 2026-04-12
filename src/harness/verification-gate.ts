/**
 * Verification Gate — pre-completion quality check.
 *
 * Runs mechanical checks (lint, typecheck, test) before
 * marking any task as complete. Returns pass/fail with
 * remediation hints.
 *
 * Ported from AI-Fleet core/harness/verification_gate.py
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type CheckName = 'git_clean' | 'lint' | 'typecheck' | 'test'

export interface CheckResult {
  name: CheckName
  status: 'pass' | 'fail' | 'skip'
  output?: string
  duration: number
}

export interface VerificationResult {
  passed: boolean
  checks: CheckResult[]
  score: number      // 0.0 - 1.0
  remediation?: string
}

/**
 * Detect which checks are available in the project.
 */
function detectChecks(cwd: string): CheckName[] {
  const checks: CheckName[] = ['git_clean']

  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf-8'))
      const scripts = pkg.scripts || {}
      if (scripts.lint || scripts['lint:check']) checks.push('lint')
      if (scripts.typecheck || existsSync(join(cwd, 'tsconfig.json'))) checks.push('typecheck')
      if (scripts.test) checks.push('test')
    } catch { /* ignore */ }
  }

  // Python
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py'))) {
    checks.push('lint', 'test')
  }

  // Go
  if (existsSync(join(cwd, 'go.mod'))) {
    checks.push('lint', 'test')
  }

  // Rust
  if (existsSync(join(cwd, 'Cargo.toml'))) {
    checks.push('typecheck', 'test')
  }

  // Deduplicate
  return [...new Set(checks)]
}

/**
 * Get the command for a specific check.
 */
function getCheckCommand(name: CheckName, cwd: string): string | null {
  switch (name) {
    case 'git_clean':
      return 'git diff --quiet HEAD 2>/dev/null'

    case 'lint': {
      if (existsSync(join(cwd, 'package.json'))) return 'npm run lint --silent 2>/dev/null'
      if (existsSync(join(cwd, 'pyproject.toml'))) return 'ruff check . 2>/dev/null'
      if (existsSync(join(cwd, 'go.mod'))) return 'go vet ./... 2>/dev/null'
      return null
    }

    case 'typecheck': {
      if (existsSync(join(cwd, 'tsconfig.json'))) return 'npx tsc --noEmit 2>/dev/null'
      if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo check 2>/dev/null'
      return null
    }

    case 'test': {
      if (existsSync(join(cwd, 'package.json'))) return 'npm test --silent 2>/dev/null'
      if (existsSync(join(cwd, 'pyproject.toml'))) return 'pytest -q 2>/dev/null'
      if (existsSync(join(cwd, 'go.mod'))) return 'go test ./... 2>/dev/null'
      if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo test --quiet 2>/dev/null'
      return null
    }

    default:
      return null
  }
}

/**
 * Run a single check.
 */
function runCheck(name: CheckName, cwd: string): CheckResult {
  const cmd = getCheckCommand(name, cwd)
  if (!cmd) return { name, status: 'skip', duration: 0 }

  const start = Date.now()
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return {
      name,
      status: 'pass',
      output: output.slice(0, 500),
      duration: Date.now() - start,
    }
  } catch (err) {
    const output = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err)
    return {
      name,
      status: 'fail',
      output: String(output).slice(0, 500),
      duration: Date.now() - start,
    }
  }
}

/**
 * Run the full verification gate.
 */
export function runVerificationGate(cwd: string, requestedChecks?: CheckName[]): VerificationResult {
  const checks = requestedChecks || detectChecks(cwd)
  const results = checks.map(name => runCheck(name, cwd))

  const passed = results.every(r => r.status === 'pass' || r.status === 'skip')
  const ran = results.filter(r => r.status !== 'skip')
  const passCount = ran.filter(r => r.status === 'pass').length
  const score = ran.length > 0 ? passCount / ran.length : 1.0

  const failed = results.filter(r => r.status === 'fail')
  let remediation: string | undefined

  if (failed.length > 0) {
    const hints = failed.map(f => {
      switch (f.name) {
        case 'git_clean': return 'Uncommitted changes detected. Commit or stash before marking complete.'
        case 'lint': return 'Lint errors found. Fix style issues before completing.'
        case 'typecheck': return 'Type errors found. Fix type issues before completing.'
        case 'test': return 'Tests are failing. Fix failing tests before completing.'
        default: return `${f.name} failed.`
      }
    })
    remediation = hints.join('\n')
  }

  return { passed, checks: results, score, remediation }
}

/**
 * Quick check — just lint + typecheck, skip tests.
 */
export function quickVerify(cwd: string): VerificationResult {
  return runVerificationGate(cwd, ['lint', 'typecheck'])
}
