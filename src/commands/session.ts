/**
 * `orca session` — Session management.
 *
 * Usage:
 *   orca session list          List saved sessions
 *   orca session show <id>     Show session details
 *   orca session delete <id>   Delete a session
 */

import { Command } from 'commander'
import { readdirSync, readFileSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SESSIONS_DIR = join(homedir(), '.orca', 'sessions')

interface SavedSession {
  model: string
  history: Array<{ role: string; content: string }>
  stats: { turns: number; inputTokens: number; outputTokens: number }
  savedAt: string
}

function listSessionFiles(): Array<{ name: string; path: string; mtime: Date }> {
  try {
    return readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f.replace('.json', ''),
        path: join(SESSIONS_DIR, f),
        mtime: statSync(join(SESSIONS_DIR, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  } catch {
    return []
  }
}

function loadSession(path: string): SavedSession | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Get the most recent session for `orca -c` continuation.
 */
export function getLastSession(): { name: string; session: SavedSession } | null {
  const files = listSessionFiles()
  if (files.length === 0) return null
  const session = loadSession(files[0]!.path)
  if (!session) return null
  return { name: files[0]!.name, session }
}

/**
 * Get a session by partial ID match.
 */
export function getSessionById(id: string): { name: string; session: SavedSession } | null {
  const files = listSessionFiles()
  const match = files.find(f => f.name.includes(id))
  if (!match) return null
  const session = loadSession(match.path)
  if (!session) return null
  return { name: match.name, session }
}

export function createSessionCommand(): Command {
  const cmd = new Command('session')
    .description('Manage saved sessions')

  cmd.command('list')
    .description('List saved sessions')
    .action(() => {
      const files = listSessionFiles()

      if (files.length === 0) {
        console.log('\n  \x1b[90m(no saved sessions)\x1b[0m\n')
        return
      }

      console.log()
      console.log('  \x1b[1mSaved Sessions\x1b[0m')
      console.log()
      console.log(`  ${'ID'.padEnd(28)} ${'Model'.padEnd(24)} ${'Turns'.padEnd(8)} Updated`)
      console.log(`  ${'─'.repeat(28)} ${'─'.repeat(24)} ${'─'.repeat(8)} ${'─'.repeat(20)}`)

      for (const f of files.slice(0, 20)) {
        const session = loadSession(f.path)
        if (!session) continue

        const id = f.name.slice(0, 28).padEnd(28)
        const model = (session.model || '?').slice(0, 24).padEnd(24)
        const turns = String(session.stats?.turns || 0).padEnd(8)
        const time = f.mtime.toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })

        console.log(`  ${id} ${model} ${turns} ${time}`)
      }

      console.log()
      console.log(`  \x1b[90m${files.length} session(s) · Continue last: orca -c\x1b[0m`)
      console.log()
    })

  // Default action: same as list
  cmd.action(async () => {
    await cmd.parseAsync(['node', 'orca', 'session', 'list'])
  })

  cmd.command('show')
    .argument('<id>', 'Session ID (partial match)')
    .description('Show session messages')
    .action((id: string) => {
      const result = getSessionById(id)
      if (!result) {
        console.error(`\x1b[31m  error: session "${id}" not found\x1b[0m`)
        process.exit(1)
      }

      console.log()
      console.log(`  \x1b[1m${result.name}\x1b[0m`)
      console.log(`  \x1b[90mModel: ${result.session.model} · Turns: ${result.session.stats?.turns || 0}\x1b[0m`)
      console.log()

      for (const msg of result.session.history) {
        const prefix = msg.role === 'user' ? '\x1b[36m  > \x1b[0m' : '\x1b[90m  \x1b[0m'
        const text = msg.content.slice(0, 200)
        console.log(`${prefix}${text}${msg.content.length > 200 ? '...' : ''}`)
        console.log()
      }
    })

  cmd.command('delete')
    .argument('<id>', 'Session ID (partial match)')
    .description('Delete a saved session')
    .action((id: string) => {
      const files = listSessionFiles()
      const match = files.find(f => f.name.includes(id))
      if (!match) {
        console.error(`\x1b[31m  error: session "${id}" not found\x1b[0m`)
        process.exit(1)
      }
      unlinkSync(match.path)
      console.log(`  \x1b[90mdeleted: ${match.name}\x1b[0m`)
    })

  return cmd
}
