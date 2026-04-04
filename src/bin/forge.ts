#!/usr/bin/env node

/**
 * Forge CLI binary entry point.
 *
 * This is the file that runs when a user types `forge` in their terminal.
 */

import { run } from '../program.js'

// Graceful shutdown on SIGINT/SIGTERM
process.on('SIGINT', () => {
  process.stdout.write('\n')
  process.exit(130)
})
process.on('SIGTERM', () => {
  process.exit(143)
})

run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
