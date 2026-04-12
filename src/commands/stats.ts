/**
 * `orca stats` — Token usage and cost statistics.
 *
 * Usage:
 *   orca stats           Overview + model breakdown
 *   orca stats daily     Daily usage chart (last 14 days)
 */

import { Command } from 'commander'
import { getStatsOverview, getModelBreakdown, getDailyUsage } from '../usage-db.js'
import { gatherDoctorReport } from '../doctor.js'
import { readLogTail } from '../logger.js'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function padR(s: string, n: number): string { return s.padEnd(n) }
function padL(s: string, n: number): string { return s.padStart(n) }

function printBox(title: string, rows: Array<[string, string]>): void {
  console.log()
  console.log('  \x1b[1m┌────────────────────────────────────────────────────────┐\x1b[0m')
  console.log(`  \x1b[1m│${title.padStart(Math.floor((56 + title.length) / 2)).padEnd(56)}│\x1b[0m`)
  console.log('  \x1b[1m├────────────────────────────────────────────────────────┤\x1b[0m')
  for (const [label, value] of rows) {
    console.log(`  \x1b[1m│\x1b[0m${padR(label, 44)}${padL(value, 10)} \x1b[1m│\x1b[0m`)
  }
  console.log('  \x1b[1m└────────────────────────────────────────────────────────┘\x1b[0m')
}

export function createStatsCommand(): Command {
  const cmd = new Command('stats')
    .description('Show token usage and cost statistics')

  cmd.action(() => {
    const overview = getStatsOverview()
    const models = getModelBreakdown()
    const doctor = gatherDoctorReport(process.cwd())
    const recentErrors = readLogTail('errors', 3)

    const ov: Array<[string, string]> = [
      ['Sessions', String(overview.totalSessions)],
      ['Messages', String(overview.totalMessages)],
      ['Days', String(overview.totalDays)],
    ]
    printBox('OVERVIEW', ov)

    const ct: Array<[string, string]> = [
      ['Total Cost', `$${overview.totalCost.toFixed(2)}`],
      ['Avg Cost/Day', `$${overview.avgCostPerDay.toFixed(2)}`],
      ['Avg Tokens/Session', formatTokens(overview.avgTokensPerSession)],
      ['Median Tokens/Session', formatTokens(overview.medianTokensPerSession)],
      ['Input', formatTokens(overview.totalInputTokens)],
      ['Output', formatTokens(overview.totalOutputTokens)],
    ]
    printBox('COST & TOKENS', ct)

    const runtime: Array<[string, string]> = [
      ['Provider', `${doctor.provider.activeProvider || 'n/a'} / ${doctor.provider.model || 'n/a'}`],
      ['Providers Configured', String(doctor.providersConfigured)],
      ['Hooks / MCP', `${doctor.hooksConfigured} / ${doctor.mcpConfigured}`],
      ['Saved Sessions', String(doctor.sessionsSaved)],
      ['Background Jobs', `${doctor.backgroundJobs.running} running / ${doctor.backgroundJobs.total} total`],
      ['Logs', `${doctor.logs.agentExists ? 'agent' : 'no-agent'} / ${doctor.logs.errorExists ? 'errors' : 'no-errors'}`],
      ['Config Issues', String(doctor.configDiagnostics.filter((entry) => !entry.valid).length)],
    ]
    printBox('RUNTIME HEALTH', runtime)
    if (doctor.provider.warning) {
      console.log(`  \x1b[33mprovider warning:\x1b[0m ${doctor.provider.warning}`)
    }

    // Model breakdown
    if (models.length > 0) {
      console.log()
      console.log('  \x1b[1m┌────────────────────────────────────────────────────────┐\x1b[0m')
      console.log('  \x1b[1m│                   MODEL BREAKDOWN                      │\x1b[0m')
      console.log('  \x1b[1m├────────────────────────────────────────────────────────┤\x1b[0m')
      for (const m of models) {
        const line = `${padR(m.model, 28)} ${padL(String(m.calls), 5)} calls  $${m.cost.toFixed(3)}`
        console.log(`  \x1b[1m│\x1b[0m ${padR(line, 53)}\x1b[1m│\x1b[0m`)
      }
      console.log('  \x1b[1m└────────────────────────────────────────────────────────┘\x1b[0m')
    }

    if (recentErrors.length > 0) {
      console.log()
      console.log('  \x1b[1mRecent Errors\x1b[0m')
      console.log()
      for (const line of recentErrors) {
        console.log(`  \x1b[90m${line}\x1b[0m`)
      }
    }
    console.log()
  })

  cmd.command('daily')
    .description('Show daily usage (last 14 days)')
    .action(() => {
      const daily = getDailyUsage(14)

      if (daily.length === 0) {
        console.log('\n  \x1b[90m(no usage data)\x1b[0m\n')
        return
      }

      console.log()
      console.log('  \x1b[1mDaily Usage (last 14 days)\x1b[0m')
      console.log()

      const maxTokens = Math.max(...daily.map(d => d.tokens), 1)

      for (const d of daily) {
        const barLen = Math.round((d.tokens / maxTokens) * 30)
        const bar = '\x1b[36m' + '█'.repeat(barLen) + '\x1b[0m' + '░'.repeat(30 - barLen)
        console.log(`  ${d.date}  ${bar}  ${formatTokens(d.tokens).padStart(6)}  $${d.cost.toFixed(3)}`)
      }
      console.log()
    })

  return cmd
}
