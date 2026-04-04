/**
 * Markdown rendering for Forge CLI.
 *
 * Renders assistant responses with syntax highlighting for code blocks,
 * styled headings, bold/italic, and lists — matching Claude Code / Codex DX.
 */

import { Marked } from 'marked'
import markedTerminal from 'marked-terminal'

let renderer: Marked | null = null

function getRenderer(): Marked {
  if (!renderer) {
    renderer = new Marked()
    renderer.use(markedTerminal({
      // Code block styling
      code: (code: string) => code,
      // Compact list rendering
      listitem: (text: string) => `  ${text}\n`,
      // Table styling
      tablerow: (content: string) => `${content}\n`,
      // Link styling
      link: (_href: string, _title: string, text: string) => text,
      // Emphasis
      strong: (text: string) => `\x1b[1m${text}\x1b[22m`,
      em: (text: string) => `\x1b[3m${text}\x1b[23m`,
      // Headings
      heading: (text: string, level: number) => {
        const prefix = level <= 2 ? '\x1b[1;36m' : '\x1b[1m'
        return `\n${prefix}${'#'.repeat(level)} ${text}\x1b[0m\n`
      },
      // Horizontal rule
      hr: () => '\x1b[90m' + '─'.repeat(60) + '\x1b[0m\n',
      // Blockquote
      blockquote: (text: string) => {
        return text.split('\n').map(line => `\x1b[90m  │ ${line}\x1b[0m`).join('\n') + '\n'
      },
      // Paragraph spacing
      paragraph: (text: string) => `${text}\n`,
    }) as Parameters<Marked['use']>[0])
  }
  return renderer
}

/**
 * Render a complete markdown string to styled terminal output.
 * Used for post-turn rendering of assistant responses.
 */
export function renderMarkdown(text: string): string {
  try {
    const result = getRenderer().parse(text)
    if (typeof result === 'string') {
      return result.replace(/\n{3,}/g, '\n\n').trim()
    }
    return text
  } catch {
    return text
  }
}

/**
 * Detect if text contains markdown that would benefit from rendering.
 * Avoids rendering simple one-line responses.
 */
export function hasMarkdown(text: string): boolean {
  // Check for code blocks, headings, lists, bold/italic, links
  return /```[\s\S]*?```|^#{1,6}\s|^\s*[-*+]\s|\*\*.*\*\*|__.*__|^\s*\d+\.\s|\[.*\]\(.*\)/m.test(text)
}
