/**
 * AlternateScreen — wraps children in the terminal's alternate screen buffer.
 *
 * Matches CC's AlternateScreen pattern:
 * - Enter: \x1b[?1049h (save cursor + switch to alt buffer)
 * - Clear: \x1b[2J\x1b[H (erase screen + cursor home)
 * - Exit: \x1b[?1049l (restore cursor + switch back to main buffer)
 *
 * This eliminates the "white gap" problem — alt screen has a clean dark
 * background that fills the entire terminal viewport.
 */

import React, { useEffect } from 'react'
import { Box } from 'ink'
import { useTerminalSize } from '../useTerminalSize.js'

const ENTER_ALT_SCREEN = '\x1b[?1049h'
const EXIT_ALT_SCREEN = '\x1b[?1049l'
const ERASE_SCREEN = '\x1b[2J'
const CURSOR_HOME = '\x1b[H'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'

interface Props {
  children: React.ReactNode
}

export function AlternateScreen({ children }: Props): React.ReactElement {
  const { rows } = useTerminalSize()

  useEffect(() => {
    // Enter alternate screen buffer on mount
    process.stdout.write(ENTER_ALT_SCREEN + ERASE_SCREEN + CURSOR_HOME + HIDE_CURSOR)

    return () => {
      // Exit alternate screen buffer on unmount (restores main buffer)
      process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN)
    }
  }, [])

  // Handle SIGCONT (resume from background) — re-enter alt screen
  useEffect(() => {
    const handler = () => {
      process.stdout.write(ENTER_ALT_SCREEN + ERASE_SCREEN + CURSOR_HOME + HIDE_CURSOR)
    }
    process.on('SIGCONT', handler)
    return () => { process.removeListener('SIGCONT', handler) }
  }, [])

  return (
    <Box flexDirection="column" height={rows} width="100%">
      {children}
    </Box>
  )
}
