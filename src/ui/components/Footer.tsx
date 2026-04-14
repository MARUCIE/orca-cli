/**
 * Footer — keyboard shortcut hints below the status bar.
 *
 * Shows context-aware shortcuts: Esc (abort), Ctrl+L (clear), Shift+Tab (mode), /help.
 * Mirrors CC's footer navigation context.
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'

interface Props {
  /** Whether the model is currently generating */
  isGenerating: boolean
  /** Whether input is active */
  isInputActive: boolean
  /** Current permission mode */
  permMode: string
}

export function Footer({ isGenerating, isInputActive, permMode }: Props): React.ReactElement {
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80

  const shortcuts: Array<{ key: string; label: string }> = []

  if (isGenerating) {
    shortcuts.push({ key: 'esc', label: 'interrupt' })
  } else if (isInputActive) {
    shortcuts.push({ key: 'enter', label: 'send' })
    shortcuts.push({ key: 'ctrl+j', label: 'newline' })
    shortcuts.push({ key: '/help', label: 'commands' })
    shortcuts.push({ key: 'shift+tab', label: permMode })
    shortcuts.push({ key: 'ctrl+z', label: 'undo' })
    shortcuts.push({ key: 'ctrl+l', label: 'clear' })
  } else {
    // Idle / waiting for prompt_ready — still show basic hints
    shortcuts.push({ key: 'enter', label: 'send' })
    shortcuts.push({ key: '/help', label: 'commands' })
    shortcuts.push({ key: 'shift+tab', label: permMode })
  }

  if (shortcuts.length === 0) return <Box height={0} />

  return (
    <Box width={cols} justifyContent="center">
      {shortcuts.map((s, i) => (
        <Box key={s.key} marginRight={2}>
          <Text dimColor>{s.key}</Text>
          <Text dimColor>{' '}{s.label}</Text>
          {i < shortcuts.length - 1 && <Text dimColor>  </Text>}
        </Box>
      ))}
    </Box>
  )
}
