/**
 * MarkdownText — renders markdown content in ink using marked + marked-terminal.
 *
 * For streaming text, the parent component accumulates tokens and passes
 * the full text here. This component renders the final formatted output.
 *
 * For completed blocks (in Static), this provides rich markdown rendering
 * with code block syntax highlighting, bold, italic, links, etc.
 */

import React, { useMemo } from 'react'
import { Text } from 'ink'

interface Props {
  children: string
}

/**
 * Render markdown text with terminal formatting.
 * Uses marked + marked-terminal for rich output.
 */
export function MarkdownText({ children }: Props): React.ReactElement {
  const rendered = useMemo(() => {
    if (!children) return ''
    try {
      // Dynamic import would be async — use require-style sync for React render
      // marked-terminal is already in deps, imported at module level
      return renderMarkdown(children)
    } catch {
      return children
    }
  }, [children])

  return <Text>{rendered}</Text>
}

// Module-level markdown rendering (sync)
let markedInstance: ((src: string) => string) | null = null

function renderMarkdown(src: string): string {
  if (!markedInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { marked } = require('marked') as { marked: { parse: (s: string) => string; use: (opts: unknown) => void } }
      const { markedTerminal } = require('marked-terminal') as { markedTerminal: () => unknown }
      marked.use(markedTerminal())
      markedInstance = (s: string) => String(marked.parse(s))
    } catch {
      // Fallback: return raw text
      markedInstance = (s: string) => s
    }
  }
  return markedInstance(src).trimEnd()
}
