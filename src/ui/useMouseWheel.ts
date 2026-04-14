/**
 * useMouseWheel — SGR mouse protocol for wheel scrolling in ink.
 *
 * Enables SGR mouse reporting (\x1b[?1003h\x1b[?1006h) which sends
 * wheel events as escape sequences: \x1b[<64;col;rowM (up) / \x1b[<65;col;rowM (down).
 *
 * Parses raw stdin for mouse wheel events and calls onWheel callback.
 * Cleans up mouse mode on unmount.
 */

import { useEffect, useRef } from 'react'
import { useStdin } from 'ink'

// SGR mouse mode: reports all events including wheel, in SGR format
const ENABLE_MOUSE = '\x1b[?1003h\x1b[?1006h'
const DISABLE_MOUSE = '\x1b[?1003l\x1b[?1006l'

// SGR mouse event: \x1b[<button;col;row(M|m)
// button 64 = wheel up, 65 = wheel down
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g

interface UseMouseWheelOptions {
  /** Whether mouse wheel tracking is active */
  isActive?: boolean
  /** Called on wheel event: positive delta = down, negative = up */
  onWheel?: (delta: number) => void
}

export function useMouseWheel(options: UseMouseWheelOptions = {}): void {
  const { isActive = true, onWheel } = options
  const { stdin } = useStdin()
  const onWheelRef = useRef(onWheel)
  onWheelRef.current = onWheel

  // Enable/disable mouse tracking
  useEffect(() => {
    if (!isActive) return
    process.stdout.write(ENABLE_MOUSE)
    return () => {
      process.stdout.write(DISABLE_MOUSE)
    }
  }, [isActive])

  // Parse raw stdin for SGR mouse events
  useEffect(() => {
    if (!isActive || !stdin) return

    const handleData = (data: Buffer) => {
      const str = data.toString()
      let match
      SGR_MOUSE_RE.lastIndex = 0
      while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
        const button = parseInt(match[1]!, 10)
        // button 64 = wheel up (scroll content up = delta negative)
        // button 65 = wheel down (scroll content down = delta positive)
        if (button === 64) {
          onWheelRef.current?.(-3) // scroll up 3 rows
        } else if (button === 65) {
          onWheelRef.current?.(3) // scroll down 3 rows
        }
      }
    }

    stdin.on('data', handleData)
    return () => {
      stdin.removeListener('data', handleData)
    }
  }, [isActive, stdin])
}
