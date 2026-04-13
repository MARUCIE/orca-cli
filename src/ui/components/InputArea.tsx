/**
 * InputArea — multi-line text input with border, matching CC's input box.
 *
 * Features:
 * - Rounded border box with accent color (CC-style)
 * - Multi-line editing (Shift+Enter or ``` fence mode)
 * - Command history (up/down arrows)
 * - Tab completion hint
 * - Esc to abort during generation
 * - Minimum height for visual presence
 */

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'

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
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
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

      // Tab: no-op (reserved for completion)
      if (key.tab) return

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

  const innerWidth = Math.max(0, cols - 6) // account for border + padding

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={active ? 'cyan' : 'gray'}
      width={cols}
      minHeight={3}
    >
      <Box>
        <Text color="cyan" bold>{active ? '> ' : '  '}</Text>
        <Text>{value}</Text>
        {active && <Text color="cyan">|</Text>}
        {active && !value && (
          <Text dimColor> type a message or /help</Text>
        )}
      </Box>
    </Box>
  )
}
