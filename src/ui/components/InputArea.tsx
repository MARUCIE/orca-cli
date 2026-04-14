/**
 * InputArea — multi-line text input with border, matching CC's input box.
 *
 * Features:
 * - Rounded border box with accent color (CC-style)
 * - Multi-line editing via newline character (\n) in buffer
 * - Ctrl+J / Ctrl+Enter to insert newline
 * - Command history (up/down arrows when on first line)
 * - Esc to abort during generation
 * - Minimum height for visual presence
 * - Cursor position tracking for mid-text editing
 */

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTheme } from '../theme.js'

interface Props {
  /** Called when user submits input (Enter) */
  onSubmit: (text: string) => void
  /** Called when user presses Esc */
  onAbort?: () => void
  /** Called on Ctrl+L (clear screen) */
  onClear?: () => void
  /** Called on Shift+Tab (mode cycle) */
  onModeCycle?: () => void
  /** Called on Ctrl+Z (undo) */
  onUndo?: () => void
  /** Called when input value changes */
  onChange?: (value: string) => void
  /** Whether input is currently accepting keystrokes */
  active: boolean
  /** When true, CommandPicker handles Enter/Esc/arrows — InputArea only handles text */
  pickerActive?: boolean
  /** When true, stdin capture is suspended (permission prompt is active) */
  permissionBlocked?: boolean
  /** Command history for up/down navigation */
  history?: string[]
}

export function InputArea({ onSubmit, onAbort, onClear, onModeCycle, onUndo, onChange, active, pickerActive, permissionBlocked, history = [] }: Props): React.ReactElement {
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
  const theme = useTheme()
  const [value, setValueRaw] = useState('')
  const [cursor, setCursor] = useState(0)
  const [historyIdx, setHistoryIdx] = useState(-1)

  const setValue = useCallback((v: string | ((prev: string) => string)) => {
    setValueRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v
      if (next !== prev) onChange?.(next)
      return next
    })
  }, [onChange])

  useInput(
    (input, key) => {
      // Always capture text input (buffer before prompt_ready).
      // Only block Enter-submit when not yet active.

      // When picker is active, defer Enter/Esc/arrows to CommandPicker
      if (pickerActive && (key.return || key.escape || key.upArrow || key.downArrow)) return

      // Enter: submit (only when active — prevents premature send)
      if (key.return && !key.ctrl) {
        if (!active) return // can't submit yet, but keep capturing text
        const trimmed = value.trim()
        onSubmit(trimmed)
        setValue('')
        setCursor(0)
        setHistoryIdx(-1)
        return
      }

      // Ctrl+J or Ctrl+Enter: insert newline
      if ((key.ctrl && input === 'j') || (key.return && key.ctrl)) {
        setValue(prev => prev.slice(0, cursor) + '\n' + prev.slice(cursor))
        setCursor(prev => prev + 1)
        return
      }

      if (key.escape) {
        onAbort?.()
        return
      }

      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue(prev => prev.slice(0, cursor - 1) + prev.slice(cursor))
          setCursor(prev => prev - 1)
        }
        return
      }

      // Shift+Tab: mode cycle
      if (key.tab && key.shift) {
        onModeCycle?.()
        return
      }

      // Tab: no-op (reserved for completion)
      if (key.tab) return

      // Ctrl+L: clear screen
      if (key.ctrl && input === 'l') {
        onClear?.()
        return
      }

      // Ctrl+Z: undo
      if (key.ctrl && input === 'z') {
        onUndo?.()
        return
      }

      // Ctrl+A: beginning of line
      if (key.ctrl && input === 'a') {
        const lineStart = value.lastIndexOf('\n', cursor - 1) + 1
        setCursor(lineStart)
        return
      }

      // Ctrl+E: end of line
      if (key.ctrl && input === 'e') {
        let lineEnd = value.indexOf('\n', cursor)
        if (lineEnd === -1) lineEnd = value.length
        setCursor(lineEnd)
        return
      }

      // Left arrow
      if (key.leftArrow) {
        setCursor(prev => Math.max(0, prev - 1))
        return
      }

      // Right arrow
      if (key.rightArrow) {
        setCursor(prev => Math.min(value.length, prev + 1))
        return
      }

      // Up arrow: history when on first line, or move cursor up in multi-line
      if (key.upArrow) {
        const lineStart = value.lastIndexOf('\n', cursor - 1)
        if (lineStart === -1 && history.length > 0) {
          // On first line: navigate history
          const next = Math.min(historyIdx + 1, history.length - 1)
          setHistoryIdx(next)
          const hVal = history[history.length - 1 - next] || ''
          setValue(hVal)
          setCursor(hVal.length)
        } else if (lineStart >= 0) {
          // Move cursor to previous line
          const prevLineStart = value.lastIndexOf('\n', lineStart - 1) + 1
          const colOffset = cursor - lineStart - 1
          setCursor(Math.min(prevLineStart + colOffset, lineStart))
        }
        return
      }

      // Down arrow: history or move cursor down
      if (key.downArrow) {
        const nextNewline = value.indexOf('\n', cursor)
        if (nextNewline === -1) {
          // On last line: history backward
          const next = historyIdx - 1
          if (next < 0) {
            setHistoryIdx(-1)
            setValue('')
            setCursor(0)
          } else {
            setHistoryIdx(next)
            const hVal = history[history.length - 1 - next] || ''
            setValue(hVal)
            setCursor(hVal.length)
          }
        } else {
          // Move cursor to next line
          const lineStart = value.lastIndexOf('\n', cursor - 1) + 1
          const colOffset = cursor - lineStart
          const nextLineEnd = value.indexOf('\n', nextNewline + 1)
          const nextLineLen = (nextLineEnd === -1 ? value.length : nextLineEnd) - (nextNewline + 1)
          setCursor(nextNewline + 1 + Math.min(colOffset, nextLineLen))
        }
        return
      }

      // Ctrl+U: clear line
      if (key.ctrl && input === 'u') {
        setValue('')
        setCursor(0)
        return
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        setValue(prev => prev.slice(0, cursor) + input + prev.slice(cursor))
        setCursor(prev => prev + input.length)
      }
    },
    { isActive: !permissionBlocked },  // Capture stdin unless permission prompt is active
  )

  const lines = value.split('\n')
  const isMultiLine = lines.length > 1

  // Calculate cursor position for display
  let charsBeforeCursor = 0
  let cursorLine = 0
  let cursorCol = 0
  for (let i = 0; i < lines.length; i++) {
    if (charsBeforeCursor + lines[i]!.length >= cursor) {
      cursorLine = i
      cursorCol = cursor - charsBeforeCursor
      break
    }
    charsBeforeCursor += lines[i]!.length + 1 // +1 for \n
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={active ? theme.accent : 'gray'}
      width={cols}
      minHeight={3}
    >
      {lines.map((line, i) => (
        <Box key={i}>
          {i === 0 ? (
            <Text color={active ? theme.prompt : 'gray'} bold={active}>{'> '}</Text>
          ) : (
            <Text color="gray">  </Text>
          )}
          {active && i === cursorLine ? (
            <Text>
              {line.slice(0, cursorCol)}
              <Text color={theme.prompt}>|</Text>
              {line.slice(cursorCol)}
            </Text>
          ) : (
            <Text>{line}</Text>
          )}
          {i === 0 && !value && (
            <Text color="gray">{active ? '' : '|'} Type a message... (/help for commands)</Text>
          )}
        </Box>
      ))}
      {active && isMultiLine && (
        <Text dimColor color="gray">  enter: send · ctrl+j: newline</Text>
      )}
    </Box>
  )
}
