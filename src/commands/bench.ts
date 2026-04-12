/**
 * `orca bench` — Self-evaluation benchmark runner.
 *
 * Runs standardized coding scenarios and reports pass/fail + score.
 * This is the SOTA capability that makes the agent self-evaluating:
 * run `orca bench` after any change to verify agent quality.
 *
 * Usage:
 *   orca bench            — run all 5 scenarios
 *   orca bench --quick    — run easy scenarios only (2 tasks)
 *   orca bench --json     — output results as JSON
 */

import { Command } from 'commander'
import { SCENARIOS, runSuite } from '../bench/scenarios.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[90m'
const BOLD = '\x1b[1m'

export function createBenchCommand(): Command {
  return new Command('bench')
    .description('Run agent benchmark — self-evaluation against standardized coding tasks')
    .option('--quick', 'Run only easy scenarios (fast smoke test)')
    .option('--json', 'Output results as JSON')
    .option('--keep', 'Keep temp directory after run (for debugging)')
    .action(async (opts: { quick?: boolean; json?: boolean; keep?: boolean }) => {
      const baseDir = join(tmpdir(), `orca-bench-${Date.now()}`)
      mkdirSync(baseDir, { recursive: true })

      const scenarios = opts.quick
        ? SCENARIOS.filter(s => s.difficulty === 'easy')
        : SCENARIOS

      if (!opts.json) {
        console.log()
        console.log(`${CYAN}${BOLD}  Orca Benchmark${RESET}`)
        console.log(`${DIM}  ${scenarios.length} scenarios · ${opts.quick ? 'quick' : 'full'} suite${RESET}`)
        console.log()
      }

      const { results, score, totalMs } = runSuite(scenarios, baseDir, (result) => {
        if (opts.json) return

        const icon = result.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`
        const time = `${DIM}${result.durationMs}ms${RESET}`
        const scenario = SCENARIOS.find(s => s.id === result.scenario)
        const diff = scenario ? `${DIM}[${scenario.difficulty}]${RESET}` : ''

        console.log(`  ${icon} ${result.scenario} ${diff} ${time}`)
        if (!result.passed) {
          console.log(`    ${RED}${result.details}${RESET}`)
        }
      })

      if (opts.json) {
        console.log(JSON.stringify({ results, score, totalMs, scenarios: scenarios.length }, null, 2))
      } else {
        console.log()
        const passed = results.filter(r => r.passed).length
        const failed = results.length - passed
        const color = score === 100 ? GREEN : score >= 80 ? CYAN : RED

        console.log(`${DIM}  ─────────────────────────────────────${RESET}`)
        console.log(`  ${color}${BOLD}Score: ${score}%${RESET} ${DIM}(${passed}/${results.length} passed, ${failed} failed)${RESET}`)
        console.log(`  ${DIM}Total: ${totalMs}ms · ${results.reduce((s, r) => s + r.toolCalls.length, 0)} tool calls${RESET}`)

        if (score === 100) {
          console.log(`\n  ${GREEN}${BOLD}SOTA READY${RESET} ${DIM}— all scenarios passed${RESET}`)
        } else if (score >= 80) {
          console.log(`\n  ${CYAN}GOOD${RESET} ${DIM}— ${failed} scenario(s) need attention${RESET}`)
        } else {
          console.log(`\n  ${RED}NEEDS WORK${RESET} ${DIM}— ${failed} scenario(s) failing${RESET}`)
        }
        console.log()
      }

      // Cleanup
      if (!opts.keep) {
        try { rmSync(baseDir, { recursive: true, force: true }) } catch { /* ignore */ }
      } else {
        console.log(`${DIM}  temp dir: ${baseDir}${RESET}\n`)
      }

      process.exit(score === 100 ? 0 : 1)
    })
}
