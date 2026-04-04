/**
 * Markdown rendering for Forge CLI.
 *
 * Two rendering paths:
 *   1. StreamMarkdown — line-buffered streaming renderer for real-time output.
 *      Tokens arrive → buffered → complete lines are formatted and flushed.
 *      Code blocks are buffered entirely and rendered with box-drawing borders.
 *
 *   2. renderMarkdown() — batch renderer via marked-terminal for post-hoc use.
 */

import { Marked } from 'marked'
import markedTerminal from 'marked-terminal'

// ── ANSI helpers ─────────────────────────────────────────────────

const RESET     = '\x1b[0m'
const BOLD      = '\x1b[1m'
const BOLD_OFF  = '\x1b[22m'
const ITALIC    = '\x1b[3m'
const ITALIC_OFF = '\x1b[23m'
const DIM       = '\x1b[90m'
const CYAN      = '\x1b[36m'
const CYAN_BOLD = '\x1b[1;36m'
const WHITE     = '\x1b[37m'
const GREEN     = '\x1b[32m'
const MAGENTA   = '\x1b[35m'
const YELLOW    = '\x1b[33m'
// Inline code: dark background + white text
const CODE_BG   = '\x1b[48;5;236m\x1b[37m'

// ── Streaming Markdown Renderer ──────────────────────────────────

/**
 * Line-buffered streaming markdown renderer.
 *
 * Tokens are pushed in via `push()`. When a newline arrives, the complete
 * line is formatted (headings, lists, blockquotes, inline bold/code/italic)
 * and written to stdout.
 *
 * Code blocks (``` … ```) are buffered entirely and rendered as a bordered
 * box when the closing fence appears.
 */
export class StreamMarkdown {
  private buffer = ''
  private inCodeBlock = false
  private codeLang = ''
  private codeLines: string[] = []
  private lastCharWasNewline = true
  private writeFn: (s: string) => void

  constructor(writeFn?: (s: string) => void) {
    this.writeFn = writeFn || ((s: string) => process.stdout.write(s))
  }

  /** Feed a streaming token. Formatted output is written as lines complete. */
  push(token: string): void {
    this.buffer += token
    this.drain()
  }

  /** Flush remaining buffer. Call when the stream ends. */
  flush(): void {
    // Close any open code block
    if (this.inCodeBlock) {
      this.renderCodeBlock()
      this.inCodeBlock = false
    }
    // Flush remaining partial line
    if (this.buffer) {
      const formatted = this.inCodeBlock ? this.buffer : this.formatInline(this.buffer)
      this.emit(formatted)
      this.buffer = ''
    }
  }

  /** Whether the last emitted character was a newline. */
  get endsWithNewline(): boolean {
    return this.lastCharWasNewline
  }

  // ── Internal ─────────────────────────────────────────────────

  private emit(text: string): void {
    if (!text) return
    this.writeFn(text)
    this.lastCharWasNewline = text.endsWith('\n')
  }

  private drain(): void {
    let nlIdx: number
    while ((nlIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nlIdx)
      this.buffer = this.buffer.slice(nlIdx + 1)
      this.processLine(line)
    }
  }

  private processLine(line: string): void {
    const trimmed = line.trimStart()

    // ── Code block fence ────────────────────────────────────────
    if (trimmed.startsWith('```')) {
      if (this.inCodeBlock) {
        this.renderCodeBlock()
        this.inCodeBlock = false
      } else {
        this.inCodeBlock = true
        this.codeLang = trimmed.slice(3).trim()
        this.codeLines = []
      }
      return
    }

    // ── Inside code block — accumulate ──────────────────────────
    if (this.inCodeBlock) {
      this.codeLines.push(line)
      return
    }

    // ── Regular line — format and emit (with 2-space indent for readability)
    const formatted = this.formatLine(line)
    this.emit((formatted ? '  ' + formatted : '') + '\n')
  }

  // ── Line-level formatting ──────────────────────────────────────

  private formatLine(line: string): string {
    // Empty line → paragraph break (preserve spacing between blocks)
    if (!line.trim()) return ''  // single blank line for paragraph separation

    // Heading: # … ######
    const hMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (hMatch) {
      const level = hMatch[1]!.length
      const color = level <= 2 ? CYAN_BOLD : BOLD
      return `\n${color}${this.formatInline(hMatch[2]!)}${RESET}`
    }

    // Horizontal rule: ---, ***, ___
    if (/^(\s*)([-*_])\s*\2\s*\2[\s\-*_]*$/.test(line)) {
      return `${DIM}${'─'.repeat(60)}${RESET}`
    }

    // Blockquote: > text
    if (line.startsWith('> ')) {
      return `${DIM}  │ ${RESET}${ITALIC}${this.formatInline(line.slice(2))}${RESET}`
    }
    // Nested blockquote
    const bqMatch = line.match(/^((?:>\s*)+)(.*)/)
    if (bqMatch) {
      const depth = (bqMatch[1]!.match(/>/g) || []).length
      const bar = `${DIM}${'  │'.repeat(depth)} ${RESET}`
      return `${bar}${ITALIC}${this.formatInline(bqMatch[2]!)}${RESET}`
    }

    // Unordered list: - / * / +
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)/)
    if (ulMatch) {
      const indent = ulMatch[1]!
      return `${indent}  ${CYAN}•${RESET} ${this.formatInline(ulMatch[3]!)}`
    }

    // Ordered list: 1. / 2. / …
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/)
    if (olMatch) {
      const indent = olMatch[1]!
      return `${indent}  ${CYAN}${olMatch[2]}.${RESET} ${this.formatInline(olMatch[3]!)}`
    }

    // Regular paragraph text
    return this.formatInline(line)
  }

  // ── Inline formatting ──────────────────────────────────────────

  private formatInline(text: string): string {
    return text
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${BOLD_OFF}`)
      .replace(/__(.+?)__/g, `${BOLD}$1${BOLD_OFF}`)
      // Strikethrough: ~~text~~
      .replace(/~~(.+?)~~/g, `${DIM}$1${RESET}`)
      // Inline code: `text`
      .replace(/`([^`]+)`/g, `${CODE_BG} $1 ${RESET}`)
      // Italic: *text* or _text_ (must not match already-consumed **)
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${ITALIC}$1${ITALIC_OFF}`)
      .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, `${ITALIC}$1${ITALIC_OFF}`)
      // Links: [text](url) → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${CYAN}$1${RESET}${DIM} ($2)${RESET}`)
      // Images: ![alt](url) → [image: alt]
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, `${DIM}[image: $1]${RESET}`)
  }

  // ── Code block rendering ───────────────────────────────────────

  private renderCodeBlock(): void {
    const lang = this.codeLang || ''
    const minWidth = 60
    // Determine box width from content
    const maxLineLen = this.codeLines.reduce((m, l) => Math.max(m, l.length), 0)
    const innerWidth = Math.max(minWidth - 4, maxLineLen + 2)
    const boxWidth = innerWidth + 4

    // Top border with language label
    if (lang) {
      const label = ` ${lang} `
      const padLen = Math.max(0, boxWidth - 4 - label.length)
      this.emit(`\n${DIM}  ╭─${RESET}${DIM}${label}${'─'.repeat(padLen)}╮${RESET}\n`)
    } else {
      this.emit(`\n${DIM}  ╭${'─'.repeat(boxWidth - 2)}╮${RESET}\n`)
    }

    // Code lines with left border
    for (const line of this.codeLines) {
      const highlighted = this.highlightCode(line, this.codeLang)
      this.emit(`${DIM}  │${RESET} ${highlighted}${RESET}\n`)
    }

    // Bottom border
    this.emit(`${DIM}  ╰${'─'.repeat(boxWidth - 2)}╯${RESET}\n\n`)
  }

  // ── Lightweight syntax highlighting ────────────────────────────

  private highlightCode(line: string, lang: string): string {
    const lower = (lang || '').toLowerCase()

    // Comments (universal for most languages)
    if (/^\s*\/\//.test(line) || /^\s*#(?!!)/.test(line)) {
      return `${DIM}${line}${RESET}`
    }

    if (['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx'].includes(lower)) {
      return this.highlightJS(line)
    }
    if (['py', 'python'].includes(lower)) {
      return this.highlightPython(line)
    }
    if (['sh', 'bash', 'zsh', 'shell'].includes(lower)) {
      return this.highlightShell(line)
    }
    if (['json', 'jsonc'].includes(lower)) {
      return this.highlightJSON(line)
    }

    // Default: white text
    return `${WHITE}${line}`
  }

  private highlightJS(line: string): string {
    return line
      // Strings first (to prevent keyword highlighting inside strings)
      .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, `${GREEN}$&${RESET}`)
      // Keywords
      .replace(/\b(const|let|var|function|return|if|else|for|while|do|import|export|from|class|extends|new|this|async|await|throw|try|catch|finally|switch|case|break|continue|default|typeof|instanceof|in|of|yield|delete|void|interface|type|enum|as|is|readonly|declare|namespace|module|implements|abstract|override|satisfies)\b/g, `${MAGENTA}$1${RESET}`)
      // Booleans/null
      .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, `${YELLOW}$1${RESET}`)
      // Numbers
      .replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, `${YELLOW}$1${RESET}`)
      // Trailing comments
      .replace(/(\/\/.*)$/gm, `${DIM}$1${RESET}`)
  }

  private highlightPython(line: string): string {
    return line
      .replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, `${GREEN}$&${RESET}`)
      .replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|pass|break|continue|yield|lambda|and|or|not|is|in|global|nonlocal|assert|async|await)\b/g, `${MAGENTA}$1${RESET}`)
      .replace(/\b(True|False|None)\b/g, `${YELLOW}$1${RESET}`)
      .replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, `${YELLOW}$1${RESET}`)
      .replace(/(#.*)$/gm, `${DIM}$1${RESET}`)
  }

  private highlightShell(line: string): string {
    return line
      .replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, `${GREEN}$&${RESET}`)
      .replace(/\b(if|then|else|elif|fi|for|do|done|while|until|case|esac|function|return|local|export|source|alias|unalias|cd|ls|grep|awk|sed|echo|cat|mkdir|rm|cp|mv|chmod|chown|curl|wget)\b/g, `${MAGENTA}$1${RESET}`)
      .replace(/(\$\{?[A-Za-z_]\w*\}?)/g, `${CYAN}$1${RESET}`)
      .replace(/(#.*)$/gm, `${DIM}$1${RESET}`)
  }

  private highlightJSON(line: string): string {
    return line
      .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, `${CYAN}$1${RESET}$2`)
      .replace(/:(\s*)("(?:[^"\\]|\\.)*")/g, `:$1${GREEN}$2${RESET}`)
      .replace(/\b(true|false|null)\b/g, `${YELLOW}$1${RESET}`)
      .replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, `${YELLOW}$1${RESET}`)
  }
}

// ── Batch Markdown Renderer (marked-terminal) ────────────────────

let renderer: Marked | null = null

function getRenderer(): Marked {
  if (!renderer) {
    renderer = new Marked()
    renderer.use(markedTerminal({
      code: (code: string) => code,
      listitem: (text: string) => `  ${text}\n`,
      tablerow: (content: string) => `${content}\n`,
      link: (_href: string, _title: string, text: string) => text,
      strong: (text: string) => `${BOLD}${text}${BOLD_OFF}`,
      em: (text: string) => `${ITALIC}${text}${ITALIC_OFF}`,
      heading: (text: string, level: number) => {
        const prefix = level <= 2 ? CYAN_BOLD : BOLD
        return `\n${prefix}${'#'.repeat(level)} ${text}${RESET}\n`
      },
      hr: () => `${DIM}${'─'.repeat(60)}${RESET}\n`,
      blockquote: (text: string) => {
        return text.split('\n').map(line => `${DIM}  │ ${line}${RESET}`).join('\n') + '\n'
      },
      paragraph: (text: string) => `${text}\n`,
    }) as Parameters<Marked['use']>[0])
  }
  return renderer
}

/**
 * Render a complete markdown string to styled terminal output.
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
 */
export function hasMarkdown(text: string): boolean {
  return /```[\s\S]*?```|^#{1,6}\s|^\s*[-*+]\s|\*\*.*\*\*|__.*__|^\s*\d+\.\s|\[.*\]\(.*\)/m.test(text)
}
