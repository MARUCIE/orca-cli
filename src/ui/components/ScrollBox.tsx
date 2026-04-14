/**
 * ScrollBox — scrollable content area for ink terminal UI.
 *
 * Implements CC-style viewport scrolling within ink's Yoga layout:
 * - Tracks scrollTop offset, renders content with negative marginTop
 * - stickyScroll: auto-follows bottom when new content is added
 * - Keyboard: PageUp/PageDown/Home/End for navigation
 * - Mouse wheel: via parent-injected onWheel (SGR mouse protocol)
 *
 * Uses ink's overflow="hidden" for viewport clipping.
 * Content height is estimated from child count × average line height,
 * with a ref-based measurement callback for post-render accuracy.
 */

import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { Box, useInput, measureElement } from 'ink'
import { useTerminalSize } from '../useTerminalSize.js'

export interface ScrollBoxHandle {
  /** Scroll to absolute position */
  scrollTo(y: number): void
  /** Scroll by relative delta (positive = down) */
  scrollBy(dy: number): void
  /** Scroll to bottom and enable sticky */
  scrollToBottom(): void
  /** Whether scroll is pinned to bottom */
  isSticky(): boolean
  /** Current scroll position */
  getScrollTop(): number
}

interface Props {
  children: React.ReactNode
  /** Whether keyboard scroll is active (disable during text input) */
  keyboardActive?: boolean
  /** Available height for viewport (if not provided, uses flexGrow) */
  height?: number
}

export const ScrollBox = forwardRef<ScrollBoxHandle, Props>(function ScrollBox(
  { children, keyboardActive = false, height },
  ref,
): React.ReactElement {
  const { rows } = useTerminalSize()
  const [scrollTop, setScrollTop] = useState(0)
  const [sticky, setSticky] = useState(true)
  const [contentHeight, setContentHeight] = useState(0)
  const contentRef = useRef<any>(null)
  const viewportHeight = height ?? rows

  // Measure content height after render
  useEffect(() => {
    if (contentRef.current) {
      try {
        const { height: h } = measureElement(contentRef.current)
        setContentHeight(h)
      } catch {
        // measureElement may fail in test environment
      }
    }
  })

  // Auto-follow bottom when sticky and content grows
  useEffect(() => {
    if (sticky && contentHeight > viewportHeight) {
      setScrollTop(Math.max(0, contentHeight - viewportHeight))
    }
  }, [sticky, contentHeight, viewportHeight])

  const maxScroll = Math.max(0, contentHeight - viewportHeight)

  const clampScroll = useCallback((y: number) => {
    return Math.max(0, Math.min(y, maxScroll))
  }, [maxScroll])

  // Imperative API
  useImperativeHandle(ref, () => ({
    scrollTo(y: number) {
      const clamped = clampScroll(y)
      setScrollTop(clamped)
      setSticky(clamped >= maxScroll)
    },
    scrollBy(dy: number) {
      setScrollTop(prev => {
        const next = clampScroll(prev + dy)
        if (next >= maxScroll) setSticky(true)
        else if (dy < 0) setSticky(false)
        return next
      })
    },
    scrollToBottom() {
      setScrollTop(maxScroll)
      setSticky(true)
    },
    isSticky() {
      return sticky
    },
    getScrollTop() {
      return scrollTop
    },
  }), [clampScroll, maxScroll, sticky, scrollTop])

  // Keyboard scroll (only when explicitly enabled and content overflows)
  useInput(
    (input, key) => {
      if (contentHeight <= viewportHeight) return // no scroll needed

      const pageSize = Math.max(1, viewportHeight - 2)

      // PageUp / Shift+Up
      if (key.pageUp || (key.upArrow && key.shift)) {
        setScrollTop(prev => {
          const next = Math.max(0, prev - pageSize)
          if (next < maxScroll) setSticky(false)
          return next
        })
        return
      }

      // PageDown / Shift+Down
      if (key.pageDown || (key.downArrow && key.shift)) {
        setScrollTop(prev => {
          const next = Math.min(maxScroll, prev + pageSize)
          if (next >= maxScroll) setSticky(true)
          return next
        })
        return
      }

      // g: scroll to top (vim-style)
      if (input === 'g' && !key.ctrl && !key.meta) {
        setScrollTop(0)
        setSticky(false)
        return
      }

      // G: scroll to bottom (vim-style)
      if (input === 'G' && !key.ctrl && !key.meta) {
        setScrollTop(maxScroll)
        setSticky(true)
        return
      }
    },
    { isActive: keyboardActive && contentHeight > viewportHeight },
  )

  return (
    <Box
      flexDirection="column"
      flexGrow={height ? undefined : 1}
      height={height}
      overflow="hidden"
    >
      <Box
        ref={contentRef}
        flexDirection="column"
        flexShrink={0}
        marginTop={-scrollTop}
      >
        {children}
      </Box>
    </Box>
  )
})
