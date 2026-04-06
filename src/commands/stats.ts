/**
 * `forge stats` — Token usage and cost statistics.
 *
 * Usage:
 *   forge stats           Overview + model breakdown
 *   forge stats daily     Daily usage chart (last 14 days)
 */

import { Command } from 'commander'
import { getStatsOverview, getModelBreakdown, getDailyUsage } from '../usage-db.js'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function padR(s: string, n: number): string { return s.padEnd(n) }
function padL(s: string, n: number): string { return s.padStart(n) }

export function createStatsCommand(): Command {
  const cmd = new Command('stats')
    .description('Show token usage and cost statistics')

  cmd.action(() => {
    const overview = getStatsOverview()
    const models = getModelBreakdown()

    // Overview box
    console.log()
    console.log('  \x1b[1m┌────────────────────────────────────────────────────────┐\x1b[0m')
    console.log('  \x1b[1m│                       OVERVIEW                         │\x1b[0m')
    console.log('  \x1b[1m├────────────────────────────────────────────────────────┤\x1b[0m')
    const ov = [
      ['Sessions', String(overview.totalSessions)],
      ['Messages', String(overview.totalMessages)],
      ['Days', String(overview.totalDays)],
    ]
    for (const [label, value] of ov) {
      console.log(`  \x1b[1m│\x1b[0m${padR(label!, 44)}${padL(value!, 10)} \x1b[1m│\x1b[0m`)
    }
    console.log('  \x1b[1m└────────────────────────────────────────────────────────┘\x1b[0m')

    // Cost & Tokens box
    console.log()
    console.log('  \x1b[1m┌────────────────────────────────────────────────────────┐\x1b[0m')
    console.log('  \x1b[1m│                    COST & TOKENS                       │\x1b[0m')
    console.log('  \x1b[1m├────────────────────────────────────────────────────────┤\x1b[0m')
    const ct = [
      ['Total Cost', `$${overview.totalCost.toFixed(2)}`],
      ['Avg Cost/Day', `$${overview.avgCostPerDay.toFixed(2)}`],
      ['Avg Tokens/Session', formatTokens(overview.avgTokensPerSession)],
      ['Median Tokens/Session', formatTokens(overview.medianTokensPerSession)],
      ['Input', formatTokens(overview.totalInputTokens)],
      ['Output', formatTokens(overview.totalOutputTokens)],
    ]
    for (const [label, value] of ct) {
      console.log(`  \x1b[1m│\x1b[0m${padR(label!, 44)}${padL(value!, 10)} \x1b[1m│\x1b[0m`)
    }
    console.log('  \x1b[1m└────────────────────────────────────────────────────────┘\x1b[0m')

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
