/**
 * Auto-Verify: Run checks after file modifications.
 *
 * When the agent edits code, auto-verify detects the project type
 * and runs relevant checks (typecheck, lint, test). Results are
 * appended to the tool output, giving the model immediate feedback
 * on whether its changes broke anything.
 *
 * This is the single highest-impact harness feature for SOTA agents:
 * it turns "edit → hope it works" into "edit → immediate feedback → fix".
 */

import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { execSync } from 'node:child_process'

// ── Types ─────────���──────────────────────────────────────────────

export interface VerifyResult {
  /** Whether all checks passed */
  passed: boolean
  /** Individual check results */
  checks: Array<{
    name: string
    passed: boolean
    output: string
    durationMs: number
  }>
  /** Summary line for appending to tool output */
  summary: string
}

export interface VerifyConfig {
  /** Whether auto-verify is enabled (default: true) */
  enabled: boolean
  /** Custom commands to run (overrides auto-detect) */
  commands?: string[]
  /** File extensions that trigger verification */
  extensions?: string[]
  /** Max time per check in ms (default: 15000) */
  timeout?: number
}

// ── Auto-Detect Project Checks ──────────────────────────────────

interface CheckCandidate {
  name: string
  command: string
  /** File that must exist for this check to run */
  requires: string
  /** File extensions this check applies to */
  extensions: string[]
}

const CHECK_CANDIDATES: CheckCandidate[] = [
  // TypeScript type checking (fastest, most valuable)
  {
    name: 'typecheck',
    command: 'npx tsc --noEmit --pretty 2>&1 | head -20',
    requires: 'tsconfig.json',
    extensions: ['.ts', '.tsx'],
  },
  // ESLint
  {
    name: 'lint',
    command: 'npx eslint --max-warnings 0 --format compact 2>&1 | tail -5',
    requires: '.eslintrc',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  // ESLint (flat config)
  {
    name: 'lint',
    command: 'npx eslint --max-warnings 0 --format compact 2>&1 | tail -5',
    requires: 'eslint.config',
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  // Python type checking
  {
    name: 'typecheck',
    command: 'python3 -m mypy --no-error-summary 2>&1 | tail -10',
    requires: 'mypy.ini',
    extensions: ['.py'],
  },
  // Python type checking (pyproject.toml)
  {
    name: 'typecheck',
    command: 'python3 -m mypy --no-error-summary 2>&1 | tail -10',
    requires: 'pyproject.toml',
    extensions: ['.py'],
  },
  // Rust check
  {
    name: 'check',
    command: 'cargo check --message-format short 2>&1 | tail -10',
    requires: 'Cargo.toml',
    extensions: ['.rs'],
  },
  // Go vet
  {
    name: 'vet',
    command: 'go vet ./... 2>&1 | tail -10',
    requires: 'go.mod',
    extensions: ['.go'],
  },
]

// ── Main Verify Function ────────────────────────────────────────

/**
 * Run auto-verify checks after a file modification.
 * Returns results that can be appended to the tool output.
 *
 * @param filePath - The file that was modified (absolute path)
 * @param cwd - Working directory
 * @param config - Optional verify configuration
 */
export function autoVerify(
  filePath: string,
  cwd: string,
  config?: Partial<VerifyConfig>,
): VerifyResult | null {
  const cfg: VerifyConfig = {
    enabled: config?.enabled ?? true,
    commands: config?.commands,
    extensions: config?.extensions,
    timeout: config?.timeout ?? 15_000,
  }

  if (!cfg.enabled) return null

  const ext = extname(filePath)

  // If custom extensions filter is set, check if file matches
  if (cfg.extensions && !cfg.extensions.includes(ext)) return null

  // Determine which checks to run
  let commands: Array<{ name: string; command: string }>

  if (cfg.commands && cfg.commands.length > 0) {
    // Custom commands override auto-detect
    commands = cfg.commands.map((cmd, i) => ({ name: `check-${i + 1}`, command: cmd }))
  } else {
    // Auto-detect based on project files
    commands = detectChecks(cwd, ext)
  }

  if (commands.length === 0) return null

  // Run checks
  const checks: VerifyResult['checks'] = []
  for (const cmd of commands) {
    const t0 = Date.now()
    try {
      const output = execSync(cmd.command, {
        cwd,
        encoding: 'utf-8',
        timeout: cfg.timeout,
        maxBuffer: 512 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      checks.push({
        name: cmd.name,
        passed: true,
        output: output.trim().slice(0, 500),
        durationMs: Date.now() - t0,
      })
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number }
      const output = ((e.stdout || '') + (e.stderr || '')).trim().slice(0, 500)
      checks.push({
        name: cmd.name,
        passed: false,
        output: output || 'Check failed',
        durationMs: Date.now() - t0,
      })
    }
  }

  const passed = checks.every(c => c.passed)
  const summary = checks.map(c =>
    `${c.passed ? '✓' : '✗'} ${c.name} (${c.durationMs}ms)${c.passed ? '' : ': ' + c.output.split('\n')[0]}`
  ).join('\n')

  return { passed, checks, summary }
}

// ── Internal ─────────��──────────────────────────────────────────

function detectChecks(cwd: string, ext: string): Array<{ name: string; command: string }> {
  const commands: Array<{ name: string; command: string }> = []
  const seen = new Set<string>()

  for (const candidate of CHECK_CANDIDATES) {
    // Skip if this check name is already added (e.g., multiple lint configs)
    if (seen.has(candidate.name)) continue

    // Check if the file extension matches
    if (!candidate.extensions.includes(ext)) continue

    // Check if the required config file exists
    // Handle prefix matches (e.g., "eslint.config" matches "eslint.config.js")
    const requiresIsPrefix = !candidate.requires.includes('.')
      || candidate.requires === '.eslintrc'
      || candidate.requires.startsWith('eslint.config')

    let found = false
    if (requiresIsPrefix) {
      try {
        const files = execSync(`ls ${cwd} 2>/dev/null`, { encoding: 'utf-8' }).split('\n')
        found = files.some(f => f.startsWith(candidate.requires))
      } catch { /* ignore */ }
    } else {
      found = existsSync(join(cwd, candidate.requires))
    }

    if (found) {
      commands.push({ name: candidate.name, command: candidate.command })
      seen.add(candidate.name)
    }
  }

  return commands
}

/**
 * Format verify result for appending to tool output.
 * Returns empty string if no checks ran or all passed silently.
 */
export function formatVerifyOutput(result: VerifyResult | null): string {
  if (!result) return ''
  if (result.passed && result.checks.length <= 1) return ''
  return `\n── verify ──\n${result.summary}`
}
