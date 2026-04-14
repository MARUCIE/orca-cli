/**
 * Tests for the Cursor text editing model.
 */

import { describe, it, expect } from 'vitest'
import * as C from '../src/ui/cursor.js'

describe('Cursor: word boundary', () => {
  it('prevWordPos skips whitespace then word chars', () => {
    expect(C.prevWordPos('hello world', 11)).toBe(6) // from end of "world" to start
    expect(C.prevWordPos('hello world', 6)).toBe(0)  // from start of "world" to start of "hello"
    expect(C.prevWordPos('hello world', 5)).toBe(0)  // from space after "hello"
  })

  it('prevWordPos handles start of string', () => {
    expect(C.prevWordPos('hello', 0)).toBe(0)
    expect(C.prevWordPos('hello', 2)).toBe(0)
  })

  it('prevWordPos handles punctuation', () => {
    expect(C.prevWordPos('foo.bar', 7)).toBe(4) // after "bar" to start of "bar"
    expect(C.prevWordPos('foo.bar', 4)).toBe(0) // dot skipped, back to "foo"
  })

  it('nextWordPos skips word chars then whitespace', () => {
    expect(C.nextWordPos('hello world', 0)).toBe(6) // from start of "hello" to start of "world"
    expect(C.nextWordPos('hello world', 6)).toBe(11) // from start of "world" to end
  })

  it('nextWordPos handles end of string', () => {
    expect(C.nextWordPos('hello', 5)).toBe(5)
    expect(C.nextWordPos('hello', 3)).toBe(5)
  })
})

describe('Cursor: movement', () => {
  it('moveLeft clamps at 0', () => {
    expect(C.moveLeft(0)).toBe(0)
    expect(C.moveLeft(5)).toBe(4)
  })

  it('moveRight clamps at text length', () => {
    expect(C.moveRight('hello', 5)).toBe(5)
    expect(C.moveRight('hello', 3)).toBe(4)
  })

  it('moveLineStart finds start of current line', () => {
    expect(C.moveLineStart('hello\nworld', 8)).toBe(6) // "world" starts at 6
    expect(C.moveLineStart('hello\nworld', 2)).toBe(0)
  })

  it('moveLineEnd finds end of current line', () => {
    expect(C.moveLineEnd('hello\nworld', 2)).toBe(5) // end of "hello"
    expect(C.moveLineEnd('hello\nworld', 8)).toBe(11)
  })

  it('moveUp navigates to previous line preserving column', () => {
    const text = 'hello\nworld'
    expect(C.moveUp(text, 8)).toBe(2) // col 2 on "world" → col 2 on "hello"
  })

  it('moveUp stays on first line', () => {
    expect(C.moveUp('hello', 3)).toBe(3)
  })

  it('moveDown navigates to next line preserving column', () => {
    const text = 'hello\nworld'
    expect(C.moveDown(text, 2)).toBe(8) // col 2 on "hello" → col 2 on "world"
  })

  it('moveDown stays on last line', () => {
    expect(C.moveDown('hello', 3)).toBe(3)
  })

  it('moveDown clamps to shorter next line', () => {
    const text = 'longerline\nhi'
    expect(C.moveDown(text, 8)).toBe(13) // col 8 → clamp to col 2 of "hi"
  })
})

describe('Cursor: editing', () => {
  it('insert adds text at cursor', () => {
    const result = C.insert({ text: 'hello', pos: 5 }, ' world')
    expect(result.text).toBe('hello world')
    expect(result.pos).toBe(11)
  })

  it('insert in middle', () => {
    const result = C.insert({ text: 'hllo', pos: 1 }, 'e')
    expect(result.text).toBe('hello')
    expect(result.pos).toBe(2)
  })

  it('deleteCharBefore removes one char', () => {
    const result = C.deleteCharBefore({ text: 'hello', pos: 5 })
    expect(result.text).toBe('hell')
    expect(result.pos).toBe(4)
  })

  it('deleteCharBefore at start is noop', () => {
    const result = C.deleteCharBefore({ text: 'hello', pos: 0 })
    expect(result.text).toBe('hello')
    expect(result.pos).toBe(0)
  })

  it('deleteWordBefore removes one word', () => {
    const { state, killed } = C.deleteWordBefore({ text: 'hello world', pos: 11 })
    expect(state.text).toBe('hello ')
    expect(state.pos).toBe(6)
    expect(killed).toBe('world')
  })

  it('deleteWordBefore removes word and preceding space', () => {
    const { state, killed } = C.deleteWordBefore({ text: 'hello world', pos: 6 })
    expect(state.text).toBe('world')
    expect(state.pos).toBe(0)
    expect(killed).toBe('hello ')
  })

  it('deleteToLineEnd kills to newline', () => {
    const { state, killed } = C.deleteToLineEnd({ text: 'hello\nworld', pos: 2 })
    expect(state.text).toBe('he\nworld')
    expect(state.pos).toBe(2)
    expect(killed).toBe('llo')
  })

  it('deleteToLineEnd at end of line joins lines', () => {
    const { state, killed } = C.deleteToLineEnd({ text: 'hello\nworld', pos: 5 })
    expect(state.text).toBe('helloworld')
    expect(state.pos).toBe(5)
    expect(killed).toBe('\n')
  })

  it('deleteToLineStart kills from line start', () => {
    // pos 8 in "hello\nworld" = after 'r', lineStart = 6
    const { state, killed } = C.deleteToLineStart({ text: 'hello\nworld', pos: 8 })
    expect(state.text).toBe('hello\nrld')
    expect(state.pos).toBe(6)
    expect(killed).toBe('wo')
  })

  it('clear resets everything', () => {
    const result = C.clear()
    expect(result.text).toBe('')
    expect(result.pos).toBe(0)
  })
})

describe('Cursor: display', () => {
  it('calculates cursor line and column', () => {
    const info = C.getCursorDisplay('hello\nworld', 8)
    expect(info.line).toBe(1)
    expect(info.col).toBe(2)
    expect(info.lines).toEqual(['hello', 'world'])
  })

  it('handles single line', () => {
    const info = C.getCursorDisplay('hello', 3)
    expect(info.line).toBe(0)
    expect(info.col).toBe(3)
  })

  it('handles cursor at end', () => {
    const info = C.getCursorDisplay('hello\nworld', 11)
    expect(info.line).toBe(1)
    expect(info.col).toBe(5)
  })

  it('handles empty string', () => {
    const info = C.getCursorDisplay('', 0)
    expect(info.line).toBe(0)
    expect(info.col).toBe(0)
    expect(info.lines).toEqual([''])
  })
})
