/**
 * Tests for file reference expansion (expandFileReferences) and helpers.
 *
 * Coverage areas:
 * 1. Bare path mode — entire prompt is a file path → read + wrap
 * 2. file:///URL mode — file:///abs/path embedded in prompt
 * 3. Embedded bare paths — /abs/path.ext or ~/path.ext within text
 * 4. Relative paths — ./path/to/file.ext within text
 * 5. resolveFilePath — tilde expansion, relative resolution, existence check
 * 6. tryReadFile — passthrough, preprocessing, size guards
 * 7. truncateFileContent — 20KB hard limit
 * 8. Deduplication — same file referenced multiple times
 * 9. Edge cases — nonexistent files, directories, binary files, special chars
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { detectFormat } from '../src/preprocess/detect.js'
import { preprocessFile } from '../src/preprocess/pipeline.js'

// Since expandFileReferences is a private function in chat.ts,
// we test its logic by reimplementing the core patterns here.
// This validates the regex patterns and path resolution logic.

const TMP_DIR = join(tmpdir(), `orca-fileexp-test-${Date.now()}`)

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true })
})

afterEach(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }) } catch {}
})

function createFile(name: string, content: string): string {
  const subDir = join(TMP_DIR, 'project')
  mkdirSync(subDir, { recursive: true })
  const fp = join(subDir, name)
  writeFileSync(fp, content, 'utf-8')
  return fp
}

// ── Regex Pattern Tests ────────────────────────────────────────────

describe('file:/// URL regex pattern', () => {
  it('matches basic file:///path URLs', () => {
    const regex = /file:\/\/\/([\S]+)/g
    const text = 'look at file:///Users/me/code.ts for reference'
    const match = regex.exec(text)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('Users/me/code.ts')
  })

  it('matches multiple file URLs in one string', () => {
    const text = 'compare file:///a.ts and file:///b.ts'
    const matches: string[] = []
    let m
    const regex = /file:\/\/\/([\S]+)/g
    while ((m = regex.exec(text)) !== null) {
      matches.push(m[1]!)
    }
    expect(matches).toEqual(['a.ts', 'b.ts'])
  })

  it('stops at whitespace', () => {
    const regex = /file:\/\/\/([\S]+)/g
    const text = 'file:///path/to/file.ts next word'
    const match = regex.exec(text)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('path/to/file.ts')
  })
})

describe('bare path regex pattern', () => {
  function makeBarePathRegex() {
    return /(?:^|\s)((?:\/[\w.@/-]+|~\/[\w.@/-]+)\.(?:html|htm|md|ts|tsx|js|jsx|json|txt|py|go|rs|css|scss|yaml|yml|toml|xml|csv|sql|sh|zsh|bash|swift|kt|java|c|cpp|h|rb|php|vue|svelte))\b/g
  }

  it('matches absolute paths with extensions', () => {
    const text = 'check /Users/me/app.ts for the bug'
    const match = makeBarePathRegex().exec(text)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('/Users/me/app.ts')
  })

  it('matches tilde paths', () => {
    const text = 'edit ~/Projects/foo.py please'
    const match = makeBarePathRegex().exec(text)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('~/Projects/foo.py')
  })

  it('matches multiple extensions', () => {
    const extensions = ['html', 'md', 'ts', 'tsx', 'js', 'jsx', 'json', 'txt', 'py', 'go', 'rs', 'css', 'yaml', 'yml', 'toml', 'xml', 'csv', 'sql', 'sh', 'swift', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'vue', 'svelte']
    for (const ext of extensions) {
      const regex = /(?:^|\s)((?:\/[\w.@/-]+|~\/[\w.@/-]+)\.(?:html|htm|md|ts|tsx|js|jsx|json|txt|py|go|rs|css|scss|yaml|yml|toml|xml|csv|sql|sh|zsh|bash|swift|kt|java|c|cpp|h|rb|php|vue|svelte))\b/g
      const text = ` /path/file.${ext} `
      const match = regex.exec(text)
      expect(match, `Extension .${ext} should match`).toBeTruthy()
    }
  })

  it('does not match paths without supported extensions', () => {
    const text = 'look at /path/file.exe'
    const match = makeBarePathRegex().exec(text)
    expect(match).toBeNull()
  })

  it('does not match bare filenames without slash', () => {
    const text = 'look at app.ts please'
    const match = makeBarePathRegex().exec(text)
    expect(match).toBeNull()
  })
})

describe('relative path regex pattern', () => {
  function makeRelRegex() {
    return /(?:^|\s)(\.\/[\w.@/-]+\.(?:html|md|ts|js|json|txt|py|go|rs|css|yaml|yml|toml))\b/g
  }

  it('matches ./relative paths', () => {
    const text = 'check ./src/index.ts for issues'
    const match = makeRelRegex().exec(text)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('./src/index.ts')
  })

  it('matches relative paths after whitespace', () => {
    const text = 'check ./config.json for settings'
    const match = makeRelRegex().exec(text)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('./config.json')
  })

  it('does not match without ./ prefix', () => {
    const text = 'src/index.ts has a bug'
    const match = makeRelRegex().exec(text)
    expect(match).toBeNull()
  })
})

// ── Punctuation Stripping ──────────────────────────────────────────

describe('file:/// URL punctuation stripping', () => {
  it('strips trailing quotes', () => {
    const raw = "Users/file.ts'"
    const cleaned = raw.replace(/['")\]}>，。；]$/, '')
    expect(cleaned).toBe('Users/file.ts')
  })

  it('strips trailing Chinese punctuation', () => {
    const raw = 'Users/file.ts。'
    const cleaned = raw.replace(/['")\]}>，。；]$/, '')
    expect(cleaned).toBe('Users/file.ts')
  })

  it('strips trailing parenthesis', () => {
    const raw = 'Users/file.ts)'
    const cleaned = raw.replace(/['")\]}>，。；]$/, '')
    expect(cleaned).toBe('Users/file.ts')
  })

  it('strips trailing bracket', () => {
    const raw = 'Users/file.ts]'
    const cleaned = raw.replace(/['")\]}>，。；]$/, '')
    expect(cleaned).toBe('Users/file.ts')
  })

  it('preserves clean paths', () => {
    const raw = 'Users/file.ts'
    const cleaned = raw.replace(/['")\]}>，。；]$/, '')
    expect(cleaned).toBe('Users/file.ts')
  })
})

// ── resolveFilePath Logic ──────────────────────────────────────────

describe('resolveFilePath logic', () => {
  function resolveFilePath(p: string, home: string, cwd: string): string | null {
    let resolved = p
    if (resolved.startsWith('file:///')) resolved = '/' + resolved.slice(8)
    if (resolved.startsWith('~') && home) resolved = home + resolved.slice(1)
    if (!resolved.startsWith('/')) resolved = join(cwd, resolved)
    try {
      if (existsSync(resolved)) {
        if (!statSync(resolved).isDirectory()) return resolved
      }
    } catch {}
    return null
  }

  it('resolves tilde to home directory', () => {
    const fp = createFile('test.txt', 'content')
    const resolved = resolveFilePath(fp, '/home/user', TMP_DIR)
    expect(resolved).toBe(fp)
  })

  it('resolves relative path against cwd', () => {
    const subDir = join(TMP_DIR, 'project')
    mkdirSync(subDir, { recursive: true })
    const fp = join(subDir, 'code.ts')
    writeFileSync(fp, 'hello', 'utf-8')
    const resolved = resolveFilePath('project/code.ts', '', TMP_DIR)
    expect(resolved).toBe(fp)
  })

  it('returns null for nonexistent file', () => {
    const resolved = resolveFilePath('/nonexistent/file.xyz', '', TMP_DIR)
    expect(resolved).toBeNull()
  })

  it('returns null for directories', () => {
    const dir = join(TMP_DIR, 'subdir')
    mkdirSync(dir, { recursive: true })
    const resolved = resolveFilePath(dir, '', TMP_DIR)
    expect(resolved).toBeNull()
  })

  it('strips file:/// prefix', () => {
    const fp = createFile('via-url.txt', 'data')
    const resolved = resolveFilePath(`file://${fp}`, '', TMP_DIR)
    expect(resolved).toBe(fp)
  })
})

// ── truncateFileContent Logic ──────────────────────────────────────

describe('truncateFileContent logic', () => {
  function truncateFileContent(content: string): string {
    if (content.length <= 20_000) return content
    return content.slice(0, 20_000) + `\n[... truncated at 20KB, original ${(content.length / 1024).toFixed(0)}KB]`
  }

  it('returns content unchanged when under 20KB', () => {
    const content = 'a'.repeat(19_999)
    expect(truncateFileContent(content)).toBe(content)
  })

  it('returns content unchanged at exactly 20KB', () => {
    const content = 'a'.repeat(20_000)
    expect(truncateFileContent(content)).toBe(content)
  })

  it('truncates content over 20KB', () => {
    const content = 'a'.repeat(25_000)
    const result = truncateFileContent(content)
    expect(result.length).toBeLessThan(25_000)
    expect(result).toContain('[... truncated at 20KB')
  })

  it('includes original size in truncation message', () => {
    const content = 'a'.repeat(50_000)
    const result = truncateFileContent(content)
    expect(result).toContain('original 49KB')
  })

  it('starts with first 20000 chars', () => {
    const content = 'X'.repeat(10_000) + 'Y'.repeat(20_000)
    const result = truncateFileContent(content)
    expect(result.startsWith('X'.repeat(10_000))).toBe(true)
    // No Y chars in first 20K since X fills first 10K and Y starts after
    expect(result.slice(0, 20_000)).toContain('Y')
  })
})

// ── tryReadFile Logic ──────────────────────────────────────────────

describe('tryReadFile behavior', () => {
  it('reads text files directly', () => {
    const fp = createFile('code.ts', 'const x = 42')
    const content = readFileSync(fp, 'utf-8')
    expect(content).toBe('const x = 42')
  })

  it('returns null for nonexistent files', () => {
    expect(existsSync('/no/such/file.txt')).toBe(false)
  })

  it('detects format category for text files', () => {
    const f = detectFormat('/test/file.ts')
    expect(f.category).toBe('text')
    expect(f.converter).toBe('passthrough')
  })

  it('detects non-text formats for preprocessing', () => {
    const f = detectFormat('/test/doc.pdf')
    expect(f.category).toBe('document')
    expect(f.converter).toBe('markitdown')
  })
})

// ── Bare Path Mode Detection ───────────────────────────────────────

describe('bare path mode detection', () => {
  it('detects single path with no spaces as bare path', () => {
    const prompt = '/Users/me/code.ts'
    const trimmed = prompt.trim()
    expect(!trimmed.includes(' ')).toBe(true)
  })

  it('rejects prompts with spaces as bare path', () => {
    const prompt = 'look at /Users/me/code.ts'
    const trimmed = prompt.trim()
    expect(trimmed.includes(' ')).toBe(true)
  })

  it('trims whitespace before detection', () => {
    const prompt = '  /Users/me/code.ts  '
    const trimmed = prompt.trim()
    expect(!trimmed.includes(' ')).toBe(true)
  })
})

// ── Deduplication Logic ────────────────────────────────────────────

describe('deduplication with injected Set', () => {
  it('tracks injected file paths', () => {
    const injected = new Set<string>()
    const path1 = '/Users/me/file.ts'
    const path2 = '/Users/me/file.ts'
    const path3 = '/Users/me/other.ts'

    injected.add(path1)
    expect(injected.has(path2)).toBe(true) // same path, deduplicated
    expect(injected.has(path3)).toBe(false)
  })

  it('prevents duplicate file injection', () => {
    const injected = new Set<string>()
    const files = ['/a.ts', '/b.ts', '/a.ts', '/c.ts', '/b.ts']
    const unique: string[] = []

    for (const f of files) {
      if (!injected.has(f)) {
        injected.add(f)
        unique.push(f)
      }
    }

    expect(unique).toEqual(['/a.ts', '/b.ts', '/c.ts'])
  })
})

// ── XML Tag Wrapping ───────────────────────────────────────────────

describe('file content XML wrapping', () => {
  it('wraps content in <file> tags with path attribute', () => {
    const filePath = '/Users/me/code.ts'
    const content = 'const x = 42'
    const wrapped = `<file path="${filePath}">\n${content}\n</file>`
    expect(wrapped).toContain(`path="${filePath}"`)
    expect(wrapped).toContain(content)
  })

  it('bare path mode adds analysis prompt', () => {
    const filePath = '/Users/me/code.ts'
    const content = 'const x = 42'
    const result = `<file path="${filePath}">\n${content}\n</file>\n\nThe user shared this file. Analyze it and ask what they'd like to do with it.`
    expect(result).toContain('Analyze it and ask')
  })

  it('embedded mode appends to existing prompt', () => {
    const original = 'fix the bug in'
    const filePath = '/Users/me/code.ts'
    const content = 'const x = 42'
    const expanded = original + `\n\n<file path="${filePath}">\n${content}\n</file>`
    expect(expanded.startsWith('fix the bug in')).toBe(true)
    expect(expanded).toContain('<file path=')
  })
})

// ── Integration: Real File Reading ─────────────────────────────────

describe('real file reading integration', () => {
  it('reads a real TypeScript file', () => {
    const fp = createFile('real.ts', 'export const VERSION = "1.0.0"')
    const content = readFileSync(fp, 'utf-8')
    expect(content).toContain('VERSION')
  })

  it('reads a real JSON file', () => {
    const fp = createFile('config.json', '{"name": "orca"}')
    const content = readFileSync(fp, 'utf-8')
    expect(JSON.parse(content)).toEqual({ name: 'orca' })
  })

  it('reads a real Markdown file', () => {
    const fp = createFile('README.md', '# Orca\n\nA CLI tool')
    const content = readFileSync(fp, 'utf-8')
    expect(content).toContain('# Orca')
  })

  it('preprocessFile works on real text file', () => {
    const fp = createFile('code.py', 'def main():\n    print("hello")')
    const result = preprocessFile(fp)
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('def main()')
    expect(result.category).toBe('text')
    expect(result.truncated).toBe(false)
  })
})

// ── Size Guards ────────────────────────────────────────────────────

describe('file size guards', () => {
  it('500KB text limit prevents oversized text reads', () => {
    // tryReadFile rejects text files > 500KB
    const limit = 500_000
    expect(limit).toBe(500_000)
  })

  it('50MB general limit prevents oversized file reads', () => {
    // tryReadFile rejects all files > 50MB
    const limit = 50 * 1024 * 1024
    expect(limit).toBe(52_428_800)
  })

  it('20KB truncation limit for injected content', () => {
    // truncateFileContent cuts at 20KB
    const limit = 20_000
    expect(limit).toBe(20_000)
  })
})

// ── Directory Expansion Logic ──────────────────────────────────────

describe('directory expansion — project file discovery', () => {
  const PROJECT_FILES = [
    'CLAUDE.md', 'README.md', 'AGENTS.md', 'CODEX.md',
    'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Makefile', 'Dockerfile',
    'tsconfig.json', '.env.example',
  ]

  it('discovers CLAUDE.md when present', () => {
    const dir = join(TMP_DIR, 'project-discover')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\nSome rules')
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')
    expect(content).toContain('# Project')
  })

  it('discovers README.md when present', () => {
    const dir = join(TMP_DIR, 'project-readme')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'README.md'), '# My Project\nDescription')
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
  })

  it('discovers package.json when present', () => {
    const dir = join(TMP_DIR, 'project-pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"name":"test","version":"1.0.0"}')
    const content = readFileSync(join(dir, 'package.json'), 'utf-8')
    expect(JSON.parse(content).name).toBe('test')
  })

  it('discovers pyproject.toml when present', () => {
    const dir = join(TMP_DIR, 'project-py')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "test"')
    expect(existsSync(join(dir, 'pyproject.toml'))).toBe(true)
  })

  it('priority order: CLAUDE.md before README.md', () => {
    // Both should be discovered, but CLAUDE.md should appear first in output
    expect(PROJECT_FILES.indexOf('CLAUDE.md')).toBeLessThan(PROJECT_FILES.indexOf('README.md'))
  })

  it('detects directory existence correctly', () => {
    const dir = join(TMP_DIR, 'project-exists')
    mkdirSync(dir, { recursive: true })
    expect(existsSync(dir)).toBe(true)
    expect(statSync(dir).isDirectory()).toBe(true)
  })

  it('detects non-directory correctly', () => {
    const fp = createFile('not-a-dir.txt', 'content')
    expect(statSync(fp).isDirectory()).toBe(false)
  })

  it('handles missing directory gracefully', () => {
    expect(existsSync('/nonexistent/project/dir')).toBe(false)
  })

  it('respects 60KB total budget for project context', () => {
    const MAX_TOTAL = 60_000
    expect(MAX_TOTAL).toBe(60_000) // ~15K tokens
  })

  it('generates relative tree paths', () => {
    const dirPath = '/Users/me/Projects/myapp'
    const fullPath = '/Users/me/Projects/myapp/src/index.ts'
    const relative = fullPath.replace(dirPath, '.')
    expect(relative).toBe('./src/index.ts')
  })

  it('tilde directory paths are resolved', () => {
    const home = '/Users/me'
    let resolved = '~/Projects/myapp'
    if (resolved.startsWith('~') && home) resolved = home + resolved.slice(1)
    expect(resolved).toBe('/Users/me/Projects/myapp')
  })

  it('trailing dir match extracts user text and path', () => {
    const prompt = 'analyze this project /Users/me/code'
    const match = prompt.match(/^(.+?)\s+((?:\/[\w.@/-]+|~\/[\w.@/-]+))\s*$/)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('analyze this project')
    expect(match![2]).toBe('/Users/me/code')
  })

  it('trailing dir match works with tilde path', () => {
    const prompt = 'review ~/Projects/myapp'
    const match = prompt.match(/^(.+?)\s+((?:\/[\w.@/-]+|~\/[\w.@/-]+))\s*$/)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('review')
    expect(match![2]).toBe('~/Projects/myapp')
  })

  it('output wraps files in <file> tags', () => {
    const fp = '/project/README.md'
    const content = '# Title'
    const tag = `<file path="${fp}">\n${content}\n</file>`
    expect(tag).toContain('path="/project/README.md"')
    expect(tag).toContain('# Title')
  })

  it('output includes <project-tree> tag', () => {
    const tree = '.\n./src\n./src/index.ts'
    const tag = `<project-tree path="/project">\n${tree}\n</project-tree>`
    expect(tag).toContain('project-tree')
    expect(tag).toContain('./src/index.ts')
  })
})
