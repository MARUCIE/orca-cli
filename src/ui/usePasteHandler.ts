/**
 * usePasteHandler — bracketed paste mode detection for ink.
 *
 * Terminals that support bracketed paste wrap pasted text in:
 *   \x1b[200~ ... \x1b[201~
 *
 * During a paste, Enter characters should be treated as literal newlines
 * (not as submit). This hook:
 * 1. Enables bracketed paste mode on mount (\x1b[?2004h)
 * 2. Tracks isPasting state by detecting the bracket sequences
 * 3. Strips bracket markers from the pasted content
 * 4. Disables bracketed paste mode on unmount (\x1b[?2004l)
 *
 * CC equivalent: usePasteHandler in BaseTextInput.tsx
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useStdin } from 'ink'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const ENABLE_BRACKETED_PASTE = '\x1b[?2004h'
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l'

interface PasteHandlerOptions {
  /** Whether paste handling is active */
  isActive?: boolean
  /** Callback when paste content is received */
  onPaste?: (text: string) => void
}

interface PasteHandlerResult {
  /** Whether a paste is currently in progress */
  isPasting: boolean
}

export function usePasteHandler(options: PasteHandlerOptions = {}): PasteHandlerResult {
  const { isActive = true, onPaste } = options
  const [isPasting, setIsPasting] = useState(false)
  const { stdin } = useStdin()
  const pasteBuffer = useRef('')
  const onPasteRef = useRef(onPaste)
  onPasteRef.current = onPaste

  // Enable/disable bracketed paste mode
  useEffect(() => {
    if (!isActive) return
    process.stdout.write(ENABLE_BRACKETED_PASTE)
    return () => {
      process.stdout.write(DISABLE_BRACKETED_PASTE)
    }
  }, [isActive])

  // Listen for raw stdin data to detect paste brackets
  useEffect(() => {
    if (!isActive || !stdin) return

    const handleData = (data: Buffer) => {
      const str = data.toString()

      // Check for paste start marker
      if (str.includes(PASTE_START)) {
        setIsPasting(true)
        // Extract content after the start marker
        const afterStart = str.split(PASTE_START).slice(1).join(PASTE_START)

        // Check if paste end is also in this chunk (short paste)
        if (afterStart.includes(PASTE_END)) {
          const content = afterStart.split(PASTE_END)[0]!
          setIsPasting(false)
          pasteBuffer.current = ''
          onPasteRef.current?.(content)
        } else {
          pasteBuffer.current = afterStart
        }
        return
      }

      // Check for paste end marker (multi-chunk paste)
      if (str.includes(PASTE_END)) {
        const beforeEnd = str.split(PASTE_END)[0]!
        const content = pasteBuffer.current + beforeEnd
        setIsPasting(false)
        pasteBuffer.current = ''
        onPasteRef.current?.(content)
        return
      }

      // Accumulate content during paste
      if (isPasting) {
        pasteBuffer.current += str
      }
    }

    stdin.on('data', handleData)
    return () => {
      stdin.removeListener('data', handleData)
    }
  }, [isActive, stdin, isPasting])

  return { isPasting }
}
