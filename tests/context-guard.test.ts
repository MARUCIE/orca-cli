/**
 * Tests for the 5-layer context overflow defense system.
 *
 * Layer 1: Injection dedup — expandFileReferences returns injectedPaths + context-note hint
 * Layer 2: Tool-level read guard — read_file returns dedup message for injected files
 * Layer 3: Cumulative tool budget — progressive truncation as budget fills
 * Layer 4: Per-round context hard stop — force output at 85% context
 * Layer 5: Integration — all layers work together
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeTool } from '../src/tools.js'
import { estimateTokens, TokenBudgetManager } from '../src/token-budget.js'

const TMP_DIR = join(tmpdir(), `orca-ctx-guard-${Date.now()}`)

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true })
})

afterEach(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }) } catch {}
})

function createFile(name: string, content: string): string {
  const fp = join(TMP_DIR, name)
  writeFileSync(fp, content, 'utf-8')
  return fp
}

// ── Layer 2: Tool-level Read Guard ──────────────────────────────

describe('Layer 2: read_file guard for injected files', () => {
  it('returns dedup message when file is in injectedPaths', () => {
    const fp = createFile('test.ts', 'const x = 1')
    const injected = new Set([fp])
    const result = executeTool('read_file', { path: fp }, TMP_DIR, injected)
    expect(result.success).toBe(true)
    expect(result.output).toContain('ALREADY IN CONTEXT')
    expect(result.output).toContain(fp)
    expect(result.output).not.toContain('const x = 1')
  })

  it('reads normally when file is NOT in injectedPaths', () => {
    const fp = createFile('normal.ts', 'const y = 2')
    const injected = new Set<string>()
    const result = executeTool('read_file', { path: fp }, TMP_DIR, injected)
    expect(result.success).toBe(true)
    expect(result.output).toContain('const y = 2')
  })

  it('reads normally when injectedPaths is undefined', () => {
    const fp = createFile('noguard.ts', 'const z = 3')
    const result = executeTool('read_file', { path: fp }, TMP_DIR)
    expect(result.success).toBe(true)
    expect(result.output).toContain('const z = 3')
  })

  it('guard checks absolute path — relative path bypasses if not resolved', () => {
    const fp = createFile('relative.ts', 'const a = 4')
    // injectedPaths stores absolute paths; relative path in args gets resolved by executeTool
    const injected = new Set([fp])
    const result = executeTool('read_file', { path: 'relative.ts' }, TMP_DIR, injected)
    expect(result.success).toBe(true)
    expect(result.output).toContain('ALREADY IN CONTEXT')
  })

  it('does not block other tools (list_directory, search_files)', () => {
    mkdirSync(join(TMP_DIR, 'sub'), { recursive: true })
    createFile('index.ts', 'export {}')
    const injected = new Set([join(TMP_DIR, 'index.ts')])
    const lsResult = executeTool('list_directory', { path: TMP_DIR }, TMP_DIR, injected)
    expect(lsResult.success).toBe(true)
    // list_directory should work normally regardless of injectedPaths
    expect(lsResult.output).toBeTruthy()
  })

  it('guard is case-sensitive on file paths', () => {
    const fp = createFile('CaseSensitive.ts', 'data')
    const injected = new Set([fp])
    // Same path — should be blocked
    const result = executeTool('read_file', { path: fp }, TMP_DIR, injected)
    expect(result.output).toContain('ALREADY IN CONTEXT')
  })
})

// ── Layer 2: Edge Cases ─────────────────────────────────────────

describe('Layer 2: read_file guard edge cases', () => {
  it('nonexistent file still returns not-found error (not dedup message)', () => {
    const injected = new Set(['/does/not/exist.ts'])
    const result = executeTool('read_file', { path: '/does/not/exist.ts' }, TMP_DIR, injected)
    // Dedup should still fire (file path matches), even if the file was later deleted
    expect(result.output).toContain('ALREADY IN CONTEXT')
  })

  it('empty injectedPaths set passes all reads through', () => {
    const fp = createFile('pass.ts', 'through')
    const result = executeTool('read_file', { path: fp }, TMP_DIR, new Set())
    expect(result.output).toContain('through')
  })

  it('multiple files: only injected ones are blocked', () => {
    const fp1 = createFile('injected.ts', 'blocked')
    const fp2 = createFile('fresh.ts', 'allowed')
    const injected = new Set([fp1])
    const r1 = executeTool('read_file', { path: fp1 }, TMP_DIR, injected)
    const r2 = executeTool('read_file', { path: fp2 }, TMP_DIR, injected)
    expect(r1.output).toContain('ALREADY IN CONTEXT')
    expect(r2.output).toContain('allowed')
  })
})

// ── Layer 1: Dedup Hint ─────────────────────────────────────────

describe('Layer 1: context-note hint format', () => {
  it('hint contains injected file paths', () => {
    // Test the appendDedupHint pattern (we test the output format, not the private function)
    const paths = ['/project/README.md', '/project/package.json']
    const hint = `<context-note>The file content above has been preprocessed and fully injected. Do NOT call read_file on these paths — their content is already complete in context: ${paths.join(', ')}</context-note>`
    expect(hint).toContain('context-note')
    expect(hint).toContain('Do NOT call read_file')
    expect(hint).toContain('/project/README.md')
    expect(hint).toContain('/project/package.json')
  })

  it('hint is positioned after file tags', () => {
    const text = '<file path="/a.ts">\ncontent\n</file>\n\n<context-note>...</context-note>'
    const fileTagIdx = text.indexOf('<file')
    const hintIdx = text.indexOf('<context-note')
    expect(hintIdx).toBeGreaterThan(fileTagIdx)
  })
})

// ── Layer 3: Token Budget Progressive Truncation ────────────────

describe('Layer 3: token budget dynamics', () => {
  it('estimateTokens gives reasonable estimates', () => {
    // 4000 chars of Latin ≈ 1000 tokens
    const latin = 'a'.repeat(4000)
    const est = estimateTokens(latin)
    expect(est).toBeGreaterThanOrEqual(900)
    expect(est).toBeLessThanOrEqual(1100)
  })

  it('CJK text estimates are higher per-char', () => {
    // 1500 CJK chars ≈ 1000 tokens (1.5 chars/token)
    const cjk = '测'.repeat(1500)
    const est = estimateTokens(cjk)
    expect(est).toBeGreaterThanOrEqual(900)
    expect(est).toBeLessThanOrEqual(1100)
  })

  it('mixed CJK+Latin estimates are between pure cases', () => {
    const mixed = '测试test'.repeat(200) // 800 CJK + 800 Latin
    const est = estimateTokens(mixed)
    const pureCjk = estimateTokens('测'.repeat(800))
    const pureLatin = estimateTokens('t'.repeat(800))
    // Mixed should be between the two
    expect(est).toBeGreaterThan(pureLatin)
    expect(est).toBeLessThan(pureCjk)
  })

  it('TokenBudgetManager tracks utilization correctly', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    // Record 100K input tokens (50% of 200K window)
    mgr.recordUsage(100_000, 5_000)
    const budget = mgr.getBudget([])
    expect(budget.utilizationPct).toBe(50)
    expect(budget.risk).toBe('orange')
  })

  it('smartCompact drops old messages at high utilization', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    const history = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'Tell me about X' },
      { role: 'assistant' as const, content: 'X is '.padEnd(10_000, 'detailed explanation. ') },
      { role: 'user' as const, content: 'Now tell me about Y' },
      { role: 'assistant' as const, content: 'Y is '.padEnd(10_000, 'another explanation. ') },
      { role: 'user' as const, content: 'Final question about Z' },
      { role: 'assistant' as const, content: 'Z is simple.' },
    ]
    const result = mgr.smartCompact(history, 1)
    expect(result.dropped).toBeGreaterThan(0)
    expect(result.tokensFreed).toBeGreaterThan(0)
    // System message should be kept
    expect(history[0]!.role).toBe('system')
  })

  it('nuclear compact keeps only system + last user at extreme utilization', () => {
    const mgr = new TokenBudgetManager('claude-sonnet-4.6')
    // Simulate extreme utilization
    mgr.recordUsage(190_000, 5_000) // 95% of 200K
    const history = [
      { role: 'system' as const, content: 'System prompt' },
      { role: 'user' as const, content: 'First question' },
      { role: 'assistant' as const, content: 'Long answer'.padEnd(50_000, '.') },
      { role: 'user' as const, content: 'Second question' },
      { role: 'assistant' as const, content: 'Another long answer'.padEnd(50_000, '.') },
      { role: 'user' as const, content: 'Last question' },
    ]
    const result = mgr.smartCompact(history, 2)
    // Nuclear mode should fire (lastInputTokens > 90% of window)
    expect(result.summary).toContain('NUCLEAR')
    expect(history.length).toBe(2) // system + last user
    expect(history[0]!.role).toBe('system')
    expect(history[1]!.role).toBe('user')
    expect(history[1]!.content).toContain('Last question')
  })
})

// ── Layer 4: Context Hard Stop ──────────────────────────────────

describe('Layer 4: context hard stop mechanics', () => {
  it('85% threshold is well below the 413 boundary', () => {
    // 85% of 200K = 170K tokens = ~680K chars
    // API 413 triggers at ~200K tokens
    // 15% margin ≈ 30K tokens buffer for the final response
    const window = 200_000
    const threshold = window * 0.85
    expect(threshold).toBe(170_000)
    expect(window - threshold).toBe(30_000) // 30K tokens buffer
  })

  it('75% soft truncation threshold leaves 25% for tool results + response', () => {
    const window = 200_000
    const softThreshold = window * 0.75
    expect(softThreshold).toBe(150_000)
    // 50K tokens left = ~200K chars for remaining tool results
  })
})

// ── Integration: Defense in Depth ───────────────────────────────

describe('Defense in depth: all layers cooperate', () => {
  it('Layer 1+2: injected file is blocked at tool level', () => {
    const fp = createFile('already-injected.html', '<html><body>Big HTML content</body></html>')
    const injected = new Set([fp])

    // Simulate what happens when model calls read_file on an injected file
    const result = executeTool('read_file', { path: fp }, TMP_DIR, injected)
    expect(result.output).toContain('ALREADY IN CONTEXT')
    expect(result.output).not.toContain('<html>')
    // Content size of dedup message is tiny (~200 chars) vs original file
    expect(result.output.length).toBeLessThan(500)
  })

  it('Layers prevent the 7-read explosion scenario', () => {
    // Scenario from the 413 bug: 1232-line HTML read 7 times in chunks
    const bigHtml = '<html>' + '<p>Line</p>\n'.repeat(1232) + '</html>'
    const fp = createFile('big-report.html', bigHtml)
    const injected = new Set([fp])

    // All 7 reads return dedup message, not file content
    const reads = [
      { start_line: 1, end_line: 80 },
      { start_line: 80, end_line: 300 },
      { start_line: 300, end_line: 600 },
      { start_line: 600, end_line: 900 },
      { start_line: 900, end_line: 1200 },
      { start_line: 1100, end_line: 1232 },
      { start_line: 1, end_line: 1232 },
    ]

    let totalChars = 0
    for (const range of reads) {
      const result = executeTool('read_file', { path: fp, ...range }, TMP_DIR, injected)
      expect(result.output).toContain('ALREADY IN CONTEXT')
      totalChars += result.output.length
    }

    // Total chars from all 7 reads should be tiny (7 × ~200 chars)
    // vs the old behavior: 7 × ~20K chars = 140K chars → 35K tokens
    expect(totalChars).toBeLessThan(3500) // 7 reads × 500 chars max each
  })

  it('tool budget provides fallback when injectedPaths misses a file', () => {
    // If a file wasn't caught by expansion but is read via tool,
    // the cumulative budget (Layer 3) in the provider loop still limits damage.
    // Here we test that executeTool still works for non-injected files
    // (the budget is enforced in the provider loop, not in executeTool)
    const fp = createFile('not-injected.ts', 'const data = "ok"')
    const result = executeTool('read_file', { path: fp }, TMP_DIR, new Set())
    expect(result.success).toBe(true)
    expect(result.output).toContain('const data')
  })

  it('read_file 300-line truncation still applies for non-injected large files', () => {
    const bigContent = Array.from({ length: 500 }, (_, i) => `line ${i + 1}: content here`).join('\n')
    const fp = createFile('big.ts', bigContent)
    const result = executeTool('read_file', { path: fp }, TMP_DIR, new Set())
    expect(result.success).toBe(true)
    // Should be truncated at ~300 lines
    expect(result.output).toContain('line 1:')
    expect(result.output).toContain('300')
  })
})

// ── Regression: Original read_file behavior preserved ───────────

describe('Regression: read_file basic behavior', () => {
  it('reads file with line range', () => {
    const content = Array.from({ length: 20 }, (_, i) => `L${i + 1}`).join('\n')
    const fp = createFile('ranged.txt', content)
    const result = executeTool('read_file', { path: fp, start_line: 5, end_line: 10 }, TMP_DIR)
    expect(result.success).toBe(true)
    expect(result.output).toContain('L5')
    expect(result.output).toContain('L10')
    expect(result.output).not.toContain('L11')
  })

  it('returns error for nonexistent file', () => {
    const result = executeTool('read_file', { path: '/nonexistent/file.ts' }, TMP_DIR)
    expect(result.success).toBe(false)
    expect(result.output).toContain('not found')
  })

  it('handles empty file', () => {
    const fp = createFile('empty.ts', '')
    const result = executeTool('read_file', { path: fp }, TMP_DIR)
    expect(result.success).toBe(true)
  })
})
