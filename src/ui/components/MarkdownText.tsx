/**
 * MarkdownText — renders markdown content in ink using marked + marked-terminal.
 *
 * Code blocks get full syntax highlighting via highlight.js → ANSI color mapping.
 * Supports 30+ languages (TypeScript, Python, Rust, Go, etc.).
 */

import React, { useMemo } from 'react'
import { Text } from 'ink'

interface Props {
  children: string
}

export function MarkdownText({ children }: Props): React.ReactElement {
  const rendered = useMemo(() => {
    if (!children) return ''
    try {
      return renderMarkdown(children)
    } catch {
      return children
    }
  }, [children])

  return <Text>{rendered}</Text>
}

// hljs class → ANSI color mapping (monokai-inspired for dark terminals)
const HLJS_COLORS: Record<string, string> = {
  'hljs-keyword':    '\x1b[35m',  // magenta
  'hljs-built_in':   '\x1b[36m',  // cyan
  'hljs-type':       '\x1b[36m',  // cyan
  'hljs-literal':    '\x1b[33m',  // yellow
  'hljs-number':     '\x1b[33m',  // yellow
  'hljs-string':     '\x1b[32m',  // green
  'hljs-comment':    '\x1b[90m',  // gray
  'hljs-doctag':     '\x1b[90m',  // gray
  'hljs-meta':       '\x1b[90m',  // gray
  'hljs-title':      '\x1b[34m',  // blue
  'hljs-function':   '\x1b[34m',  // blue
  'hljs-class':      '\x1b[34m',  // blue
  'hljs-params':     '\x1b[37m',  // white
  'hljs-attr':       '\x1b[36m',  // cyan
  'hljs-attribute':  '\x1b[36m',  // cyan
  'hljs-variable':   '\x1b[31m',  // red
  'hljs-regexp':     '\x1b[31m',  // red
  'hljs-symbol':     '\x1b[33m',  // yellow
  'hljs-template-variable': '\x1b[33m',
  'hljs-addition':   '\x1b[32m',  // green
  'hljs-deletion':   '\x1b[31m',  // red
  'hljs-selector-tag': '\x1b[35m',
  'hljs-selector-class': '\x1b[33m',
  'hljs-selector-id': '\x1b[34m',
  'hljs-property':   '\x1b[36m',  // cyan
  'hljs-name':       '\x1b[35m',  // magenta
  'hljs-tag':        '\x1b[35m',  // magenta
  'hljs-subst':      '\x1b[37m',  // white
  'hljs-section':    '\x1b[34m',  // blue
  'hljs-bullet':     '\x1b[33m',  // yellow
}
const RESET = '\x1b[0m'

/** Convert hljs HTML spans to ANSI-colored text */
function hljsToAnsi(html: string): string {
  return html
    .replace(/<span class="([^"]+)">/g, (_match, cls: string) => {
      for (const c of cls.split(/\s+/)) {
        if (HLJS_COLORS[c]) return HLJS_COLORS[c]!
      }
      return ''
    })
    .replace(/<\/span>/g, RESET)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
}

// Lazy-loaded hljs
let hljs: { highlight: (code: string, opts: { language: string }) => { value: string }; getLanguage: (lang: string) => unknown } | null = null

function loadHljs() {
  if (hljs) return hljs
  try {
    hljs = require('highlight.js') as typeof hljs
  } catch {
    hljs = null
  }
  return hljs
}

// Module-level markdown rendering (sync)
let markedInstance: ((src: string) => string) | null = null

function renderMarkdown(src: string): string {
  if (!markedInstance) {
    try {
      const { marked } = require('marked') as { marked: { parse: (s: string) => string; use: (opts: unknown) => void } }
      const { markedTerminal } = require('marked-terminal') as { markedTerminal: (opts?: unknown) => unknown }

      // First apply marked-terminal for general markdown formatting
      marked.use(markedTerminal())

      // Then override code block rendering with hljs syntax highlighting
      marked.use({
        renderer: {
          code(token: { text: string; lang?: string }) {
            const lang = token.lang || ''
            let code = token.text
            const h = loadHljs()
            if (h && lang && h.getLanguage(lang)) {
              try {
                code = hljsToAnsi(h.highlight(code, { language: lang }).value)
              } catch { /* fallback to plain */ }
            }
            return '\n' + code.split('\n').map((l: string) => `    ${l}`).join('\n') + '\n'
          },
        },
      })

      markedInstance = (s: string) => String(marked.parse(s))
    } catch {
      markedInstance = (s: string) => s
    }
  }
  return markedInstance(src).trimEnd()
}
