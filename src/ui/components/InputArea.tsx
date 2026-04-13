/**
 * InputArea — text input with prompt symbol.
 *
 * Renders ❯ prefix and captures keystrokes via ink's useInput.
 * Supports command history (up/down), submission (Enter), and abort (Esc).
 */

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

interface Props {
  /** Called when user submits input (Enter) */
  onSubmit: (text: string) => void
  /** Called when user presses Esc */
  onAbort?: () => void
  /** Whether input is currently accepting keystrokes */
  active: boolean
  /** Command history for up/down navigation */
  history?: string[]
}

export function InputArea({ onSubmit, onAbort, active, history = [] }: Props): React.ReactElement {
  const [value, setValue] = useState('')
  const [historyIdx, setHistoryIdx] = useState(-1)

  useInput(
    (input, key) => {
      if (!active) return

      if (key.return) {
        const trimmed = value.trim()
        onSubmit(trimmed)
        setValue('')
        setHistoryIdx(-1)
        return
      }

      if (key.escape) {
        onAbort?.()
        return
      }

      if (key.backspace || key.delete) {
        setValue(prev => prev.slice(0, -1))
        return
      }

      if (key.upArrow && history.length > 0) {
        const next = Math.min(historyIdx + 1, history.length - 1)
        setHistoryIdx(next)
        setValue(history[history.length - 1 - next] || '')
        return
      }

      if (key.downArrow) {
        const next = historyIdx - 1
        if (next < 0) {
          setHistoryIdx(-1)
          setValue('')
        } else {
          setHistoryIdx(next)
          setValue(history[history.length - 1 - next] || '')
        }
        return
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        setValue(prev => prev + input)
      }
    },
    { isActive: active },
  )

  return (
    <Box>
      <Text color="cyan" bold>{'>'}</Text>
      <Text> {value}</Text>
      {active && <Text color="cyan">|</Text>}
    </Box>
  )
}
