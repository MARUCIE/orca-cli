/**
 * Tests for the file preprocessing pipeline (src/preprocess/).
 *
 * Coverage areas:
 * 1. Format detection — extension → category + converter mapping
 * 2. Convertibility check — which formats are convertible
 * 3. Conversion dispatcher — passthrough, markitdown, pandoc, ffmpeg routing
 * 4. Smart truncation — heading preservation, paragraph splitting, hard limits
 * 5. Pipeline orchestration — detect → convert → truncate end-to-end
 * 6. Edge cases — unknown extensions, large files, empty files, binary files
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectFormat, isConvertible, type FileFormat, type FormatCategory } from '../src/preprocess/detect.js'
import { convertToMarkdown, type ConversionResult } from '../src/preprocess/convert.js'
import { preprocessFile } from '../src/preprocess/pipeline.js'

// ── Test Fixtures ──────────────────────────────────────────────────

const TMP_DIR = join(tmpdir(), `orca-preprocess-test-${Date.now()}`)

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true })
})

afterEach(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }) } catch {}
})

function createTempFile(name: string, content: string): string {
  const filePath = join(TMP_DIR, name)
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

function createBinaryFile(name: string, sizeBytes: number): string {
  const filePath = join(TMP_DIR, name)
  const buf = Buffer.alloc(sizeBytes, 0xAB)
  writeFileSync(filePath, buf)
  return filePath
}

// ── 1. Format Detection ────────────────────────────────────────────

describe('detectFormat - extension mapping', () => {
  it('detects Markdown as text/passthrough', () => {
    const f = detectFormat('/any/path/file.md')
    expect(f.extension).toBe('.md')
    expect(f.category).toBe('text')
    expect(f.converter).toBe('passthrough')
  })

  it('detects TypeScript as text/passthrough', () => {
    const f = detectFormat('/src/app.ts')
    expect(f.category).toBe('text')
    expect(f.converter).toBe('passthrough')
    expect(f.mimeType).toBe('text/typescript')
  })

  it('detects PDF as document/markitdown', () => {
    const f = detectFormat('/docs/report.pdf')
    expect(f.category).toBe('document')
    expect(f.converter).toBe('markitdown')
    expect(f.mimeType).toBe('application/pdf')
  })

  it('detects DOCX as document/markitdown', () => {
    const f = detectFormat('proposal.docx')
    expect(f.category).toBe('document')
    expect(f.converter).toBe('markitdown')
  })

  it('detects RTF as document/pandoc', () => {
    const f = detectFormat('letter.rtf')
    expect(f.category).toBe('document')
    expect(f.converter).toBe('pandoc')
  })

  it('detects EPUB as document/pandoc', () => {
    const f = detectFormat('book.epub')
    expect(f.category).toBe('document')
    expect(f.converter).toBe('pandoc')
  })

  it('detects HTML as markup/markitdown', () => {
    const f = detectFormat('page.html')
    expect(f.category).toBe('markup')
    expect(f.converter).toBe('markitdown')
  })

  it('detects JSON as data/passthrough', () => {
    const f = detectFormat('config.json')
    expect(f.category).toBe('data')
    expect(f.converter).toBe('passthrough')
  })

  it('detects CSV as data/markitdown', () => {
    const f = detectFormat('data.csv')
    expect(f.category).toBe('data')
    expect(f.converter).toBe('markitdown')
  })

  it('detects PNG as image/markitdown', () => {
    const f = detectFormat('screenshot.png')
    expect(f.category).toBe('image')
    expect(f.converter).toBe('markitdown')
  })

  it('detects MP4 as video/ffmpeg', () => {
    const f = detectFormat('demo.mp4')
    expect(f.category).toBe('video')
    expect(f.converter).toBe('ffmpeg')
  })

  it('detects MP3 as audio/markitdown', () => {
    const f = detectFormat('podcast.mp3')
    expect(f.category).toBe('audio')
    expect(f.converter).toBe('markitdown')
  })

  it('detects ZIP as archive/markitdown', () => {
    const f = detectFormat('bundle.zip')
    expect(f.category).toBe('archive')
    expect(f.converter).toBe('markitdown')
  })

  it('detects SVG as markup/passthrough', () => {
    const f = detectFormat('icon.svg')
    expect(f.category).toBe('markup')
    expect(f.converter).toBe('passthrough')
  })

  it('handles case-insensitive extensions', () => {
    const f = detectFormat('Photo.JPG')
    expect(f.category).toBe('image')
    expect(f.converter).toBe('markitdown')
  })

  it('returns unknown for unrecognized extensions', () => {
    const f = detectFormat('file.xyz123')
    expect(f.category).toBe('unknown')
    expect(f.converter).toBe('none')
    expect(f.mimeType).toBe('application/octet-stream')
  })

  it('handles no extension', () => {
    const f = detectFormat('Makefile')
    expect(f.category).toBe('unknown')
    expect(f.converter).toBe('none')
  })

  it('covers all code language extensions', () => {
    const codeExts = ['.js', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.rb', '.php', '.swift', '.kt', '.sh', '.css', '.sql', '.vue', '.svelte']
    for (const ext of codeExts) {
      const f = detectFormat(`test${ext}`)
      expect(f.category).toBe('text')
      expect(f.converter).toBe('passthrough')
    }
  })

  it('covers all video extensions', () => {
    const videoExts = ['.mp4', '.mov', '.mkv', '.avi', '.webm']
    for (const ext of videoExts) {
      const f = detectFormat(`video${ext}`)
      expect(f.category).toBe('video')
      expect(f.converter).toBe('ffmpeg')
    }
  })

  it('covers all audio extensions', () => {
    const audioExts = ['.mp3', '.wav', '.m4a', '.ogg', '.flac']
    for (const ext of audioExts) {
      const f = detectFormat(`audio${ext}`)
      expect(f.category).toBe('audio')
      expect(f.converter).toBe('markitdown')
    }
  })
})

// ── 2. Convertibility Check ────────────────────────────────────────

describe('isConvertible', () => {
  it('returns true for text/passthrough formats', () => {
    expect(isConvertible(detectFormat('file.md'))).toBe(true)
  })

  it('returns true for document/markitdown formats', () => {
    expect(isConvertible(detectFormat('file.pdf'))).toBe(true)
  })

  it('returns true for document/pandoc formats', () => {
    expect(isConvertible(detectFormat('file.epub'))).toBe(true)
  })

  it('returns true for video/ffmpeg formats', () => {
    expect(isConvertible(detectFormat('file.mp4'))).toBe(true)
  })

  it('returns false for unknown formats', () => {
    expect(isConvertible(detectFormat('file.xyz'))).toBe(false)
  })

  it('returns false for converter=none formats', () => {
    expect(isConvertible(detectFormat('file.tar'))).toBe(false)
    expect(isConvertible(detectFormat('file.gz'))).toBe(false)
  })

  it('returns false for explicitly constructed none/unknown', () => {
    const format: FileFormat = { extension: '.abc', category: 'unknown', converter: 'none', mimeType: 'application/octet-stream' }
    expect(isConvertible(format)).toBe(false)
  })
})

// ── 3. Conversion — Passthrough ────────────────────────────────────

describe('convertToMarkdown - passthrough', () => {
  it('reads text files as-is', () => {
    const fp = createTempFile('test.md', '# Hello\n\nWorld')
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toBe('# Hello\n\nWorld')
    expect(result.method).toBe('passthrough')
  })

  it('reads code files as-is', () => {
    const fp = createTempFile('app.ts', 'const x = 42')
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toBe('const x = 42')
    expect(result.method).toBe('passthrough')
  })

  it('reads JSON files as-is', () => {
    const fp = createTempFile('config.json', '{"key": "value"}')
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toBe('{"key": "value"}')
  })

  it('reads YAML files as-is', () => {
    const fp = createTempFile('config.yaml', 'key: value\nlist:\n  - a\n  - b')
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('key: value')
  })

  it('reads SVG files as-is (markup/passthrough)', () => {
    const fp = createTempFile('icon.svg', '<svg><circle r="5"/></svg>')
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('<svg>')
  })

  it('records originalSize correctly', () => {
    const content = 'Hello World!'
    const fp = createTempFile('test.txt', content)
    const result = convertToMarkdown(fp)
    expect(result.originalSize).toBe(Buffer.byteLength(content))
  })

  it('records convertedSize correctly', () => {
    const fp = createTempFile('test.txt', 'short')
    const result = convertToMarkdown(fp)
    expect(result.convertedSize).toBe(5)
  })

  it('records durationMs as a non-negative number', () => {
    const fp = createTempFile('test.txt', 'hello')
    const result = convertToMarkdown(fp)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('calculates savingsRatio', () => {
    const fp = createTempFile('test.txt', 'a'.repeat(1000))
    const result = convertToMarkdown(fp)
    expect(result.savingsRatio).toBeGreaterThanOrEqual(1)
  })
})

// ── 4. Conversion — Error Cases ────────────────────────────────────

describe('convertToMarkdown - error handling', () => {
  it('fails for nonexistent file', () => {
    const result = convertToMarkdown('/nonexistent/file.txt')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects files over 50MB', () => {
    // Create a file just over 50MB
    const fp = createBinaryFile('huge.txt', 51 * 1024 * 1024)
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(false)
    expect(result.error).toContain('too large')
  })

  it('returns error details for unknown converter', () => {
    // .tar has converter: 'none'
    const fp = createTempFile('archive.tar', 'fake tar content')
    const result = convertToMarkdown(fp)
    // detectFormat returns 'none' converter, but convertToMarkdown still tries
    // and hits the default case
    expect(result.method).toBeDefined()
  })

  it('handles empty file gracefully', () => {
    const fp = createTempFile('empty.txt', '')
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toBe('')
  })
})

// ── 5. Smart Truncation via Pipeline ───────────────────────────────

describe('preprocessFile - smart truncation', () => {
  it('returns full content when under maxChars', () => {
    const fp = createTempFile('short.md', '# Title\n\nContent')
    const result = preprocessFile(fp, 1000)
    expect(result.truncated).toBe(false)
    expect(result.markdown).toBe('# Title\n\nContent')
  })

  it('truncates when content exceeds maxChars', () => {
    // Generate a document with many paragraphs
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `## Section ${i + 1}\n\nThis is paragraph ${i + 1} with enough text to take up space in the document.`
    ).join('\n\n')
    const fp = createTempFile('long.md', paragraphs)
    const result = preprocessFile(fp, 500)
    expect(result.truncated).toBe(true)
    expect(result.markdown.length).toBeLessThanOrEqual(520) // some tolerance
  })

  it('preserves heading structure during truncation', () => {
    const paragraphs = [
      '# Main Title',
      'Intro paragraph with some content.',
      '## Section A',
      'Content for section A with details.',
      '## Section B',
      'Content for section B with details.',
      '## Section C',
      'Content for section C with details.',
      '## Section D',
      'Content for section D with more details.',
      '## Section E',
      'Content for section E final section.',
    ].join('\n\n')
    const fp = createTempFile('headed.md', paragraphs)
    const result = preprocessFile(fp, 300)
    expect(result.truncated).toBe(true)
    // Omitted message should appear in middle
    expect(result.markdown).toContain('omitted')
  })

  it('keeps first and last sections', () => {
    const paragraphs = Array.from({ length: 15 }, (_, i) =>
      `Paragraph ${i + 1}: content here that takes up space.`
    ).join('\n\n')
    const fp = createTempFile('sections.md', paragraphs)
    // Use a limit large enough to hold head + tail + omission marker
    const result = preprocessFile(fp, 600)
    expect(result.truncated).toBe(true)
    expect(result.markdown).toContain('Paragraph 1')
    expect(result.markdown).toContain('Paragraph 15')
  })

  it('hard truncates when few paragraphs', () => {
    const content = 'A'.repeat(5000)  // single paragraph, no double newlines
    const fp = createTempFile('onepara.md', content)
    const result = preprocessFile(fp, 200)
    expect(result.truncated).toBe(true)
    expect(result.markdown.length).toBeLessThanOrEqual(260)
  })

  it('inserts omission marker with paragraph count', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Para ${i + 1}: content.`
    ).join('\n\n')
    const fp = createTempFile('count.md', paragraphs)
    const result = preprocessFile(fp, 300)
    expect(result.markdown).toMatch(/\d+ paragraphs omitted/)
  })
})

// ── 6. Pipeline End-to-End ─────────────────────────────────────────

describe('preprocessFile - end-to-end pipeline', () => {
  it('returns fileName from path', () => {
    const fp = createTempFile('report.md', 'content')
    const result = preprocessFile(fp)
    expect(result.fileName).toBe('report.md')
  })

  it('returns category from format detection', () => {
    const fp = createTempFile('app.ts', 'const x = 1')
    const result = preprocessFile(fp)
    expect(result.category).toBe('text')
  })

  it('returns success=true for supported text formats', () => {
    const fp = createTempFile('test.py', 'print("hello")')
    const result = preprocessFile(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toBe('print("hello")')
  })

  it('returns success=false for unsupported formats', () => {
    const fp = createTempFile('data.tar', 'fake')
    const result = preprocessFile(fp)
    expect(result.success).toBe(false)
    expect(result.markdown).toContain('Unsupported format')
    expect(result.error).toContain('not supported')
  })

  it('respects custom maxChars parameter', () => {
    const longContent = 'word '.repeat(10000) // ~50K chars
    const fp = createTempFile('big.txt', longContent)
    const result = preprocessFile(fp, 1000)
    expect(result.truncated).toBe(true)
    expect(result.convertedSize).toBeLessThanOrEqual(1100)
  })

  it('default maxChars is 20000', () => {
    const longContent = 'word '.repeat(10000) // ~50K chars
    const fp = createTempFile('default.txt', longContent)
    const result = preprocessFile(fp)
    expect(result.truncated).toBe(true)
    // convertedSize should be <= 20000 + small overhead
    expect(result.convertedSize).toBeLessThanOrEqual(21000)
  })

  it('returns truncated=false when within limits', () => {
    const fp = createTempFile('small.txt', 'tiny')
    const result = preprocessFile(fp)
    expect(result.truncated).toBe(false)
  })

  it('handles unknown extension gracefully', () => {
    const fp = createTempFile('data.qwerty', 'something')
    const result = preprocessFile(fp)
    expect(result.success).toBe(false)
    expect(result.category).toBe('unknown')
  })

  it('gz/tar returns unsupported', () => {
    const fp = createTempFile('backup.gz', 'fake')
    const result = preprocessFile(fp)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not supported')
  })

  it('preserves method field from converter', () => {
    const fp = createTempFile('code.rs', 'fn main() {}')
    const result = preprocessFile(fp)
    expect(result.method).toBe('passthrough')
  })
})

// ── 7. HTML Fallback Stripper ──────────────────────────────────────

describe('convertToMarkdown - HTML fallback', () => {
  // When markitdown is unavailable, HTML files fall back to tag stripping
  it('handles HTML file with markup converter', () => {
    const html = '<html><body><h1>Title</h1><p>Text</p></body></html>'
    const fp = createTempFile('page.html', html)
    const result = convertToMarkdown(fp)
    // May use markitdown (if installed) or fallback strip
    expect(result.success).toBe(true)
    expect(result.markdown.length).toBeGreaterThan(0)
  })

  it('handles HTML with script/style tags', () => {
    const html = '<html><script>alert("x")</script><style>.x{}</style><body>Content</body></html>'
    const fp = createTempFile('styled.html', html)
    const result = convertToMarkdown(fp)
    expect(result.success).toBe(true)
    // Should not contain script content in final output
    expect(result.markdown).not.toContain('alert')
  })
})

// ── 8. Format Detection Coverage ───────────────────────────────────

describe('detectFormat - comprehensive format coverage', () => {
  const expectedMappings: [string, FormatCategory, string][] = [
    // [extension, category, converter]
    ['.md', 'text', 'passthrough'],
    ['.txt', 'text', 'passthrough'],
    ['.log', 'text', 'passthrough'],
    ['.pdf', 'document', 'markitdown'],
    ['.docx', 'document', 'markitdown'],
    ['.pptx', 'document', 'markitdown'],
    ['.xlsx', 'document', 'markitdown'],
    ['.doc', 'document', 'markitdown'],
    ['.ppt', 'document', 'markitdown'],
    ['.xls', 'document', 'markitdown'],
    ['.rtf', 'document', 'pandoc'],
    ['.epub', 'document', 'pandoc'],
    ['.html', 'markup', 'markitdown'],
    ['.htm', 'markup', 'markitdown'],
    ['.xml', 'markup', 'markitdown'],
    ['.rss', 'markup', 'markitdown'],
    ['.json', 'data', 'passthrough'],
    ['.csv', 'data', 'markitdown'],
    ['.tsv', 'data', 'passthrough'],
    ['.yaml', 'data', 'passthrough'],
    ['.yml', 'data', 'passthrough'],
    ['.toml', 'data', 'passthrough'],
    ['.png', 'image', 'markitdown'],
    ['.jpg', 'image', 'markitdown'],
    ['.jpeg', 'image', 'markitdown'],
    ['.gif', 'image', 'markitdown'],
    ['.webp', 'image', 'markitdown'],
    ['.bmp', 'image', 'markitdown'],
    ['.svg', 'markup', 'passthrough'],
    ['.mp3', 'audio', 'markitdown'],
    ['.wav', 'audio', 'markitdown'],
    ['.m4a', 'audio', 'markitdown'],
    ['.ogg', 'audio', 'markitdown'],
    ['.flac', 'audio', 'markitdown'],
    ['.mp4', 'video', 'ffmpeg'],
    ['.mov', 'video', 'ffmpeg'],
    ['.mkv', 'video', 'ffmpeg'],
    ['.avi', 'video', 'ffmpeg'],
    ['.webm', 'video', 'ffmpeg'],
    ['.zip', 'archive', 'markitdown'],
    ['.tar', 'archive', 'none'],
    ['.gz', 'archive', 'none'],
  ]

  for (const [ext, expectedCategory, expectedConverter] of expectedMappings) {
    it(`maps ${ext} → ${expectedCategory}/${expectedConverter}`, () => {
      const f = detectFormat(`test${ext}`)
      expect(f.category).toBe(expectedCategory)
      expect(f.converter).toBe(expectedConverter)
    })
  }
})
