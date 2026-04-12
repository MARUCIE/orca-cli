/**
 * Round 8: E2E Workflow & Rendering — 12 tests
 * SOTA Dimension D10: Full agent experience
 *
 * Tests markdown rendering, system prompt generation, and
 * complete understand→plan→code→test→commit workflow.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { StreamMarkdown, renderMarkdown, hasMarkdown } from '../src/markdown.js'
import { buildSystemPrompt } from '../src/system-prompt.js'
import { TOOL_DEFINITIONS, executeTool } from '../src/tools.js'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const testDir = join(tmpdir(), `orca-e2e-${Date.now()}`)

beforeAll(() => {
  mkdirSync(join(testDir, 'src'), { recursive: true })
  mkdirSync(join(testDir, 'tests'), { recursive: true })

  writeFileSync(join(testDir, 'src', 'calculator.ts'), `
export class Calculator {
  add(a: number, b: number): number {
    return a + b
  }
  subtract(a: number, b: number): number {
    return a - b
  }
}
`)

  writeFileSync(join(testDir, 'package.json'), '{"name":"e2e-test","version":"1.0.0"}\n')

  try {
    execSync('git init && git add -A && git commit -m "init: calculator"', {
      cwd: testDir, encoding: 'utf-8', stdio: 'pipe',
    })
  } catch { /* ignore */ }
})

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ── Markdown Rendering ──────────────────────────────────────────

describe('StreamMarkdown renderer', () => {
  function capture(fn: (sm: StreamMarkdown) => void): string {
    let output = ''
    const sm = new StreamMarkdown((s: string) => { output += s })
    fn(sm)
    sm.flush()
    return output
  }

  it('8.1 renders headings with ANSI colors', () => {
    const out = capture(sm => sm.push('# Hello World\n'))
    // Should contain the text and ANSI escape codes
    expect(out).toContain('Hello World')
    // Should have cyan bold for h1/h2 (escape code 1;36)
    expect(out).toContain('\x1b[1;36m')
  })

  it('8.2 renders code blocks with box-drawing borders', () => {
    const out = capture(sm => {
      sm.push('```typescript\n')
      sm.push('const x = 1\n')
      sm.push('```\n')
    })
    // Should contain box-drawing characters
    expect(out).toContain('╭')
    expect(out).toContain('╰')
    expect(out).toContain('│')
    // Should contain language label
    expect(out).toContain('typescript')
    // Should contain actual code (may be split by ANSI color codes)
    expect(out).toContain('const')
    expect(out).toContain('x =')
    expect(out).toContain('1')
  })

  it('8.3 renders inline formatting', () => {
    const out = capture(sm => sm.push('This has **bold** and `code` text\n'))
    // Bold: \x1b[1m
    expect(out).toContain('\x1b[1m')
    expect(out).toContain('bold')
    // Inline code background: \x1b[48;5;236m
    expect(out).toContain('\x1b[48;5;236m')
    expect(out).toContain('code')
  })

  it('8.4 JS/TS code highlighting — keywords colored', () => {
    const out = capture(sm => {
      sm.push('```javascript\n')
      sm.push('const x = true\n')
      sm.push('```\n')
    })
    // Keywords should be magenta (\x1b[35m)
    expect(out).toContain('\x1b[35m')
    // Booleans should be yellow (\x1b[33m)
    expect(out).toContain('\x1b[33m')
  })

  it('8.5 Python code highlighting', () => {
    const out = capture(sm => {
      sm.push('```python\n')
      sm.push('def hello():\n')
      sm.push('    return True\n')
      sm.push('```\n')
    })
    // def should be magenta
    expect(out).toContain('\x1b[35m')
    // True should be yellow
    expect(out).toContain('\x1b[33m')
  })

  it('8.6 Shell highlighting — variables colored', () => {
    const out = capture(sm => {
      sm.push('```bash\n')
      sm.push('echo $HOME\n')
      sm.push('```\n')
    })
    // $HOME should be cyan (\x1b[36m)
    expect(out).toContain('\x1b[36m')
    expect(out).toContain('HOME')
  })

  it('8.7 JSON highlighting — keys and values colored', () => {
    const out = capture(sm => {
      sm.push('```json\n')
      sm.push('{"name": "orca", "active": true}\n')
      sm.push('```\n')
    })
    // Keys should be cyan, strings green, booleans yellow
    expect(out).toContain('\x1b[36m')
    expect(out).toContain('\x1b[33m')
  })
})

// ── System Prompt ───────────────────────────────────────────────

describe('System prompt generation', () => {
  it('8.8 includes all 41 tools', () => {
    const prompt = buildSystemPrompt('/test/dir')
    expect(prompt).toContain(`Available Tools (${TOOL_DEFINITIONS.length})`)
    expect(prompt).toContain('41')
    // Spot-check some tools
    expect(prompt).toContain('read_file')
    expect(prompt).toContain('edit_file')
    expect(prompt).toContain('spawn_agent')
    expect(prompt).toContain('mcp_list_servers')
  })

  it('8.9 tool signatures match definitions', () => {
    const prompt = buildSystemPrompt('/test/dir')
    // Each tool should have its parameters listed
    for (const tool of TOOL_DEFINITIONS) {
      expect(prompt).toContain(`**${tool.function.name}**`)
    }
  })
})

// ── Batch Markdown Renderer ─────────────────────────────────────

describe('Batch markdown', () => {
  it('8.10 renderMarkdown handles complete document', () => {
    const md = '# Title\n\nParagraph with **bold** text.\n\n- Item 1\n- Item 2\n'
    const result = renderMarkdown(md)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('8.11 hasMarkdown detection accuracy', () => {
    expect(hasMarkdown('# Heading')).toBe(true)
    expect(hasMarkdown('```code```')).toBe(true)
    expect(hasMarkdown('**bold**')).toBe(true)
    expect(hasMarkdown('- list item')).toBe(true)
    expect(hasMarkdown('1. ordered')).toBe(true)
    expect(hasMarkdown('[link](url)')).toBe(true)
    expect(hasMarkdown('plain text no markdown')).toBe(false)
  })
})

// ── Full E2E Workflow ───────────────────────────────────────────

describe('E2E: understand → plan → code → test → commit', () => {
  it('8.12 Complete agent workflow', () => {
    // Step 1: Understand — read the project
    const read = executeTool('read_file', { path: 'src/calculator.ts' }, testDir)
    expect(read.success).toBe(true)
    expect(read.output).toContain('Calculator')

    // Step 2: Plan — create implementation plan
    const plan = executeTool('create_plan', {
      goal: 'Add multiply and divide methods to Calculator',
      steps: [
        'Add multiply method',
        'Add divide method with zero check',
        'Create test file',
        'Verify with git diff',
      ],
    }, testDir)
    expect(plan.success).toBe(true)

    // Step 3: Code — implement the changes
    const edit = executeTool('edit_file', {
      path: 'src/calculator.ts',
      old_string: `  subtract(a: number, b: number): number {
    return a - b
  }
}`,
      new_string: `  subtract(a: number, b: number): number {
    return a - b
  }

  multiply(a: number, b: number): number {
    return a * b
  }

  divide(a: number, b: number): number {
    if (b === 0) throw new Error('Division by zero')
    return a / b
  }
}`,
    }, testDir)
    expect(edit.success).toBe(true)

    // Step 3b: Create test file
    const writeTest = executeTool('write_file', {
      path: 'tests/calculator.test.ts',
      content: `import { Calculator } from '../src/calculator'

describe('Calculator', () => {
  const calc = new Calculator()
  it('multiplies', () => expect(calc.multiply(3, 4)).toBe(12))
  it('divides', () => expect(calc.divide(10, 2)).toBe(5))
  it('throws on zero division', () => {
    expect(() => calc.divide(1, 0)).toThrow('Division by zero')
  })
})
`,
    }, testDir)
    expect(writeTest.success).toBe(true)

    // Step 4: Verify — check the implementation
    const verify = executeTool('verify_plan', {
      checks: [
        'grep -q "multiply" src/calculator.ts',
        'grep -q "divide" src/calculator.ts',
        'grep -q "Division by zero" src/calculator.ts',
        'test -f tests/calculator.test.ts',
      ],
    }, testDir)
    expect(verify.success).toBe(true)
    expect(verify.output).not.toContain('✗')

    // Step 5: Commit — save changes
    const diff = executeTool('git_diff', {}, testDir)
    expect(diff.success).toBe(true)
    expect(diff.output).toContain('multiply')
    expect(diff.output).toContain('divide')

    const commit = executeTool('git_commit', {
      message: 'feat: add multiply and divide methods to Calculator',
    }, testDir)
    expect(commit.success).toBe(true)

    // Final verification: git log shows the commit
    const log = executeTool('git_log', { count: 1 }, testDir)
    expect(log.success).toBe(true)
    expect(log.output).toContain('multiply')
  })
})
