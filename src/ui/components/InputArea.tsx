/**
 * InputArea — multi-line text input with border, matching CC's input box.
 *
 * Features:
 * - Rounded border box with accent color (CC-style)
 * - Multi-line editing via newline character (\n) in buffer
 * - Ctrl+J / Ctrl+Enter / Meta+Enter / Shift+Enter to insert newline
 * - Word-boundary operations (Ctrl+W, Option+Left/Right)
 * - Kill/yank buffer (Ctrl+K / Ctrl+Y)
 * - Command history (up/down arrows when on first line)
 * - Esc to abort during generation
 * - Bracketed paste handling (Enter → newline during paste)
 * - Cursor position tracking for mid-text editing
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../theme.js'
import { useTerminalSize } from '../useTerminalSize.js'
import { usePasteHandler } from '../usePasteHandler.js'
import * as C from '../cursor.js'

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
  /** Show cursor even when input is not active (e.g., during modal) */
  showCursor?: boolean
  /** Command history for up/down navigation */
  history?: string[]
}

export function InputArea({ onSubmit, onAbort, onClear, onModeCycle, onUndo, onChange, active, pickerActive, permissionBlocked, showCursor, history = [] }: Props): React.ReactElement {
  const { cols } = useTerminalSize()
  const theme = useTheme()
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [killRing, setKillRing] = useState('')

  // Bracketed paste: detect paste mode, insert content with newlines preserved
  const { isPasting } = usePasteHandler({
    isActive: !permissionBlocked,
    onPaste: useCallback((text: string) => {
      setValue(prev => {
        const result = C.insert({ text: prev, pos: cursor }, text)
        setCursor(result.pos)
        return result.text
      })
    }, [cursor]),
  })

  // Notify parent of value changes via useEffect (not during render)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current?.(value)
  }, [value])

  // Helper: apply a CursorState update
  const applyState = useCallback((newState: C.CursorState) => {
    setValue(newState.text)
    setCursor(newState.pos)
  }, [])

  useInput(
    (input, key) => {
      // Filter out mouse escape sequences that leak through from SGR mouse mode.
      // These look like \x1b[<N;N;N(M|m) and should never be treated as text input.
      if (input && /\x1b\[<|;.*[Mm]$/.test(input)) return

      // When picker is active, defer Enter/Esc/arrows to CommandPicker
      if (pickerActive && (key.return || key.escape || key.upArrow || key.downArrow)) return

      // Ctrl+J / Ctrl+Enter / Meta+Enter / Shift+Enter: insert newline (must check BEFORE plain Enter)
      if ((key.ctrl && input === 'j') || (key.return && key.ctrl) || (key.return && key.meta) || (key.return && key.shift)) {
        applyState(C.insert({ text: value, pos: cursor }, '\n'))
        return
      }

      // Enter: submit (unless pasting — paste Enter becomes literal newline)
      if (key.return) {
        if (isPasting) {
          applyState(C.insert({ text: value, pos: cursor }, '\n'))
          return
        }
        const trimmed = value.trim()
        onSubmit(trimmed)
        applyState(C.clear())
        setHistoryIdx(-1)
        return
      }

      if (key.escape) {
        onAbort?.()
        return
      }

      // Backspace/Delete
      if (key.backspace || key.delete) {
        applyState(C.deleteCharBefore({ text: value, pos: cursor }))
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

      // Ctrl+W: delete word before cursor (kill ring)
      if (key.ctrl && input === 'w') {
        const result = C.deleteWordBefore({ text: value, pos: cursor })
        applyState(result.state)
        if (result.killed) setKillRing(result.killed)
        return
      }

      // Ctrl+K: delete to end of line (kill ring)
      if (key.ctrl && input === 'k') {
        const result = C.deleteToLineEnd({ text: value, pos: cursor })
        applyState(result.state)
        if (result.killed) setKillRing(result.killed)
        return
      }

      // Ctrl+Y: yank (paste from kill ring)
      if (key.ctrl && input === 'y') {
        if (killRing) {
          applyState(C.insert({ text: value, pos: cursor }, killRing))
        }
        return
      }

      // Ctrl+U: delete to start of line (kill ring)
      if (key.ctrl && input === 'u') {
        const result = C.deleteToLineStart({ text: value, pos: cursor })
        applyState(result.state)
        if (result.killed) setKillRing(result.killed)
        return
      }

      // Ctrl+A: beginning of line
      if (key.ctrl && input === 'a') {
        setCursor(C.moveLineStart(value, cursor))
        return
      }

      // Ctrl+E: end of line
      if (key.ctrl && input === 'e') {
        setCursor(C.moveLineEnd(value, cursor))
        return
      }

      // Left arrow (Option+Left = word left via meta key)
      if (key.leftArrow) {
        setCursor(key.meta ? C.moveWordLeft(value, cursor) : C.moveLeft(cursor))
        return
      }

      // Right arrow (Option+Right = word right via meta key)
      if (key.rightArrow) {
        setCursor(key.meta ? C.moveWordRight(value, cursor) : C.moveRight(value, cursor))
        return
      }

      // Up arrow: history when on first line, or move cursor up in multi-line
      if (key.upArrow) {
        const lineStart = value.lastIndexOf('\n', cursor - 1)
        if (lineStart === -1 && history.length > 0) {
          const next = Math.min(historyIdx + 1, history.length - 1)
          setHistoryIdx(next)
          const hVal = history[history.length - 1 - next] || ''
          setValue(hVal)
          setCursor(hVal.length)
        } else if (lineStart >= 0) {
          setCursor(C.moveUp(value, cursor))
        }
        return
      }

      // Down arrow: history or move cursor down
      if (key.downArrow) {
        const nextNewline = value.indexOf('\n', cursor)
        if (nextNewline === -1) {
          const next = historyIdx - 1
          if (next < 0) {
            setHistoryIdx(-1)
            applyState(C.clear())
          } else {
            setHistoryIdx(next)
            const hVal = history[history.length - 1 - next] || ''
            setValue(hVal)
            setCursor(hVal.length)
          }
        } else {
          setCursor(C.moveDown(value, cursor))
        }
        return
      }

      // Regular character input (reject escape sequences and control chars)
      if (input && !key.ctrl && !key.meta && !input.includes('\x1b')) {
        applyState(C.insert({ text: value, pos: cursor }, input))
      }
    },
    { isActive: !permissionBlocked },
  )

  const { line: cursorLine, col: cursorCol, lines } = C.getCursorDisplay(value, cursor)
  const isMultiLine = lines.length > 1
  // Show cursor when explicitly enabled or when input is active
  const cursorVisible = showCursor ?? active

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={active ? theme.border : theme.borderDim}
      width={cols}
      minHeight={3}
    >
      {lines.map((line, i) => (
        <Box key={i}>
          {i === 0 ? (
            <Text color={active ? theme.prompt : theme.dim} bold={active}>{'> '}</Text>
          ) : (
            <Text color={theme.dim}>  </Text>
          )}
          {cursorVisible && i === cursorLine ? (
            <Text>
              {line.slice(0, cursorCol)}
              <Text color={theme.prompt}>|</Text>
              {line.slice(cursorCol)}
            </Text>
          ) : (
            <Text>{line}</Text>
          )}
          {i === 0 && !value && (
            <Text color={theme.muted}>{active ? '' : '|'} Type a message... (/help for commands)</Text>
          )}
        </Box>
      ))}
      {active && isMultiLine && (
        <Text dimColor color="gray">  enter: send · ctrl+j: newline</Text>
      )}
    </Box>
  )
}
