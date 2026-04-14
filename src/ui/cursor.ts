/**
 * Cursor — pure-function text editing model with word-boundary operations.
 *
 * All functions take {text, pos} and return a new {text, pos} (or just {pos}).
 * Designed for React useState integration — no mutation, no side effects.
 *
 * CC equivalent: Cursor class in useTextInput.ts with prevWord/nextWord/deleteTokenBefore.
 */

export interface CursorState {
  text: string
  pos: number
}

// ── Word boundary detection ──

/** Is this character a word character? (alphanumeric + underscore) */
function isWordChar(ch: string): boolean {
  return /[\w]/.test(ch)
}

/** Find the start of the previous word from position */
export function prevWordPos(text: string, pos: number): number {
  if (pos <= 0) return 0
  let p = pos - 1
  // Skip whitespace/non-word chars
  while (p > 0 && !isWordChar(text[p]!)) p--
  // Skip word chars
  while (p > 0 && isWordChar(text[p - 1]!)) p--
  return p
}

/** Find the end of the next word from position */
export function nextWordPos(text: string, pos: number): number {
  const len = text.length
  if (pos >= len) return len
  let p = pos
  // Skip word chars
  while (p < len && isWordChar(text[p]!)) p++
  // Skip whitespace/non-word chars
  while (p < len && !isWordChar(text[p]!)) p++
  return p
}

// ── Movement operations (return new pos only) ──

export function moveLeft(pos: number): number {
  return Math.max(0, pos - 1)
}

export function moveRight(text: string, pos: number): number {
  return Math.min(text.length, pos + 1)
}

export function moveWordLeft(text: string, pos: number): number {
  return prevWordPos(text, pos)
}

export function moveWordRight(text: string, pos: number): number {
  return nextWordPos(text, pos)
}

export function moveLineStart(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1
}

export function moveLineEnd(text: string, pos: number): number {
  const nl = text.indexOf('\n', pos)
  return nl === -1 ? text.length : nl
}

export function moveUp(text: string, pos: number): number {
  const lineStart = text.lastIndexOf('\n', pos - 1)
  if (lineStart === -1) return pos // already on first line
  const col = pos - lineStart - 1
  const prevLineStart = text.lastIndexOf('\n', lineStart - 1) + 1
  return Math.min(prevLineStart + col, lineStart)
}

export function moveDown(text: string, pos: number): number {
  const nextNl = text.indexOf('\n', pos)
  if (nextNl === -1) return pos // already on last line
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const col = pos - lineStart
  const nextLineEnd = text.indexOf('\n', nextNl + 1)
  const nextLineLen = (nextLineEnd === -1 ? text.length : nextLineEnd) - (nextNl + 1)
  return nextNl + 1 + Math.min(col, nextLineLen)
}

// ── Editing operations (return new CursorState) ──

/** Insert text at cursor position */
export function insert(state: CursorState, str: string): CursorState {
  return {
    text: state.text.slice(0, state.pos) + str + state.text.slice(state.pos),
    pos: state.pos + str.length,
  }
}

/** Delete one character before cursor (Backspace) */
export function deleteCharBefore(state: CursorState): CursorState {
  if (state.pos <= 0) return state
  return {
    text: state.text.slice(0, state.pos - 1) + state.text.slice(state.pos),
    pos: state.pos - 1,
  }
}

/** Delete one word before cursor (Ctrl+W) */
export function deleteWordBefore(state: CursorState): { state: CursorState; killed: string } {
  const newPos = prevWordPos(state.text, state.pos)
  const killed = state.text.slice(newPos, state.pos)
  return {
    state: {
      text: state.text.slice(0, newPos) + state.text.slice(state.pos),
      pos: newPos,
    },
    killed,
  }
}

/** Delete from cursor to end of line (Ctrl+K) */
export function deleteToLineEnd(state: CursorState): { state: CursorState; killed: string } {
  const end = moveLineEnd(state.text, state.pos)
  // If cursor is at end of line, delete the newline char
  const actualEnd = end === state.pos && end < state.text.length ? end + 1 : end
  const killed = state.text.slice(state.pos, actualEnd)
  return {
    state: {
      text: state.text.slice(0, state.pos) + state.text.slice(actualEnd),
      pos: state.pos,
    },
    killed,
  }
}

/** Delete from cursor to start of line (Ctrl+U) */
export function deleteToLineStart(state: CursorState): { state: CursorState; killed: string } {
  const start = moveLineStart(state.text, state.pos)
  const killed = state.text.slice(start, state.pos)
  return {
    state: {
      text: state.text.slice(0, start) + state.text.slice(state.pos),
      pos: start,
    },
    killed,
  }
}

/** Clear all text */
export function clear(): CursorState {
  return { text: '', pos: 0 }
}

// ── Display helpers ──

export interface CursorDisplayInfo {
  line: number
  col: number
  lines: string[]
}

/** Calculate cursor line/col for display rendering */
export function getCursorDisplay(text: string, pos: number): CursorDisplayInfo {
  const lines = text.split('\n')
  let charsBeforeCursor = 0
  for (let i = 0; i < lines.length; i++) {
    if (charsBeforeCursor + lines[i]!.length >= pos) {
      return { line: i, col: pos - charsBeforeCursor, lines }
    }
    charsBeforeCursor += lines[i]!.length + 1 // +1 for \n
  }
  // Fallback: cursor at end
  return { line: lines.length - 1, col: lines[lines.length - 1]!.length, lines }
}
