/**
 * FileLink — OSC 8 hyperlink for terminal file paths.
 *
 * When supported (iTerm2, Warp, kitty, WezTerm, GNOME Terminal),
 * file paths become Cmd+Click / Ctrl+Click navigable.
 * Falls back to plain text on unsupported terminals.
 *
 * OSC 8 format: \x1b]8;;URI\x07DISPLAY_TEXT\x1b]8;;\x07
 */

import React from 'react'
import { Text } from 'ink'

interface Props {
  path: string
  /** Line number for editor jump (file:line format) */
  line?: number
  /** Display text override (defaults to path) */
  children?: string
  color?: string
}

// Detect OSC 8 support via TERM_PROGRAM
const OSC8_SUPPORTED = /^(iTerm|WezTerm|warp|kitty|vscode)/i.test(process.env.TERM_PROGRAM || '')

export function FileLink({ path, line, children, color }: Props): React.ReactElement {
  const display = children || path
  const absPath = path.startsWith('/') ? path : `${process.cwd()}/${path}`
  const uri = line ? `file://${absPath}:${line}` : `file://${absPath}`

  if (OSC8_SUPPORTED) {
    // Wrap in OSC 8 hyperlink escape sequence
    const linked = `\x1b]8;;${uri}\x07${display}\x1b]8;;\x07`
    return <Text color={color}>{linked}</Text>
  }

  return <Text color={color}>{display}</Text>
}
