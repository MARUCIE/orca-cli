/**
 * `orca logs` — View local Orca runtime logs.
 *
 * Usage:
 *   orca logs             Show agent.log tail
 *   orca logs errors      Show errors.log tail
 */

import { Command } from 'commander'
import { getLogPath, readLogTail } from '../logger.js'

export function createLogsCommand(): Command {
  const cmd = new Command('logs')
    .description('Show local Orca runtime logs')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .argument('[kind]', 'Log kind: agent (default) or errors')
    .action((kindArg?: string, opts?: { lines?: string }) => {
      const kind = kindArg === 'errors' ? 'errors' : 'agent'
      const lines = Math.max(1, Number(opts?.lines) || 50)
      const entries = readLogTail(kind, lines)

      console.log()
      console.log(`  \x1b[1mOrca Logs: ${kind}\x1b[0m`)
      console.log(`  \x1b[90m${getLogPath(kind)}\x1b[0m`)
      console.log()

      if (entries.length === 0) {
        console.log('  \x1b[90m(no log entries)\x1b[0m')
        console.log()
        return
      }

      for (const entry of entries) {
        console.log(`  ${entry}`)
      }
      console.log()
    })

  return cmd
}
