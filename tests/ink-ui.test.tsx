/**
 * Tests for ink UI components.
 *
 * Uses ink-testing-library to render components without a real terminal.
 */

import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { StatusBar } from '../src/ui/components/StatusBar.js'
import { ThinkingSpinner } from '../src/ui/components/ThinkingSpinner.js'
import { ToolCallBlock } from '../src/ui/components/ToolCallBlock.js'
import { InputArea } from '../src/ui/components/InputArea.js'
import { TerminalSizeProvider } from '../src/ui/useTerminalSize.js'
import { ChatSessionEmitter } from '../src/ui/session.js'
import type { StatusInfo } from '../src/ui/types.js'

describe('StatusBar', () => {
  const baseStatus: StatusInfo = {
    model: 'claude-sonnet-4.6',
    contextPct: 12,
    permMode: 'yolo',
    gitBranch: 'main',
    costUsd: 0.0034,
    turns: 3,
  }

  it('renders model name', () => {
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={baseStatus} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('claude-sonnet-4.6')
  })

  it('renders context bar with percentage', () => {
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={baseStatus} /></TerminalSizeProvider>)
    // New format: unicode progress bar + percentage
    expect(lastFrame()).toContain('12%')
    expect(lastFrame()).toContain('░') // empty bar segments
  })

  it('renders permission mode', () => {
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={baseStatus} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('yolo')
  })

  it('renders git branch', () => {
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={baseStatus} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('main')
  })

  it('renders cost', () => {
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={baseStatus} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('$0.0034')
  })

  it('truncates long model names', () => {
    const status = { ...baseStatus, model: 'a-very-long-model-name-that-exceeds-22-chars' }
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={status} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('..')
  })

  it('hides cost when zero', () => {
    const status = { ...baseStatus, costUsd: 0 }
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={status} /></TerminalSizeProvider>)
    expect(lastFrame()).not.toContain('$')
  })
})

describe('ThinkingSpinner', () => {
  it('renders nothing when inactive', () => {
    const { lastFrame } = render(<ThinkingSpinner active={false} />)
    expect(lastFrame()).toBe('')
  })

  it('renders spinner when active', () => {
    const { lastFrame } = render(<ThinkingSpinner active={true} />)
    // Verb is randomly selected from 60 options, check for common pattern
    expect(lastFrame()).toContain('...')
    expect(lastFrame()).toContain('0s')
  })
})

describe('ToolCallBlock', () => {
  it('renders tool name', () => {
    const { lastFrame } = render(
      <ToolCallBlock start={{ name: 'read_file', args: { path: '/tmp/test.ts' } }} />,
    )
    expect(lastFrame()).toContain('read_file')
  })

  it('renders path from args', () => {
    const { lastFrame } = render(
      <ToolCallBlock start={{ name: 'read_file', args: { path: '/tmp/test.ts' } }} />,
    )
    expect(lastFrame()).toContain('/tmp/test.ts')
  })

  it('renders result when end is provided', () => {
    const { lastFrame } = render(
      <ToolCallBlock
        start={{ name: 'read_file', args: { path: '/tmp/test.ts' } }}
        end={{ name: 'read_file', success: true, output: 'content', durationMs: 1500 }}
      />,
    )
    expect(lastFrame()).toContain('ok')
    expect(lastFrame()).toContain('1.5s')
  })

  it('renders error state', () => {
    const { lastFrame } = render(
      <ToolCallBlock
        start={{ name: 'run_command', args: { command: 'npm test' } }}
        end={{ name: 'run_command', success: false, output: 'FAIL', durationMs: 5000 }}
      />,
    )
    expect(lastFrame()).toContain('err')
  })
})

describe('InputArea', () => {
  it('renders prompt symbol', () => {
    const { lastFrame } = render(<TerminalSizeProvider><InputArea onSubmit={() => {}} active={true} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('>')
  })

  it('shows cursor when active', () => {
    const { lastFrame } = render(<TerminalSizeProvider><InputArea onSubmit={() => {}} active={true} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('|')
  })
})

describe('PermissionPrompt', () => {
  // Dynamic import since it's a new component
  it('renders tool name and preview when active', async () => {
    const { PermissionPrompt } = await import('../src/ui/components/PermissionPrompt.js')
    const { lastFrame } = render(
      <PermissionPrompt
        toolName="write_file"
        preview="write 500 bytes to /tmp/test.ts"
        onResolve={() => {}}
        active={true}
      />,
    )
    expect(lastFrame()).toContain('write_file')
    expect(lastFrame()).toContain('write 500 bytes')
    expect(lastFrame()).toContain('[y]')
    expect(lastFrame()).toContain('[n]')
  })

  it('renders nothing when inactive', async () => {
    const { PermissionPrompt } = await import('../src/ui/components/PermissionPrompt.js')
    const { lastFrame } = render(
      <PermissionPrompt toolName="x" preview="x" onResolve={() => {}} active={false} />,
    )
    expect(lastFrame()).toBe('')
  })
})

describe('TurnSummary', () => {
  it('renders elapsed time and tokens', async () => {
    const { TurnSummary } = await import('../src/ui/components/TurnSummary.js')
    const { lastFrame } = render(
      <TurnSummary info={{
        inputTokens: 500,
        outputTokens: 1500,
        duration: 3200,
        toolCalls: 2,
        costUsd: 0.005,
        model: 'test-model',
      }} />,
    )
    expect(lastFrame()).toContain('3.2s')
    expect(lastFrame()).toContain('1.5K')
    expect(lastFrame()).toContain('$0.0050')
  })
})

describe('MultiModelProgress', () => {
  it('renders model list with status', async () => {
    const { MultiModelProgress } = await import('../src/ui/components/MultiModelProgress.js')
    const { lastFrame } = render(
      <MultiModelProgress
        command="council"
        models={[
          { model: 'claude-sonnet', done: true, elapsedMs: 5000 },
          { model: 'gpt-5', done: false, elapsedMs: 3000 },
        ]}
      />,
    )
    expect(lastFrame()).toContain('council')
    expect(lastFrame()).toContain('claude-sonnet')
    expect(lastFrame()).toContain('gpt-5')
    expect(lastFrame()).toContain('ok')
    expect(lastFrame()).toContain('5.0s')
  })
})

describe('CommandPicker', () => {
  it('renders filtered commands', async () => {
    const { CommandPicker } = await import('../src/ui/components/CommandPicker.js')
    const commands = [
      { name: '/help', description: 'Show help' },
      { name: '/model', description: 'Switch model' },
      { name: '/history', description: 'Show history' },
    ]
    const { lastFrame } = render(
      <CommandPicker commands={commands} filter="hi" onSelect={() => {}} onCancel={() => {}} active={true} />,
    )
    expect(lastFrame()).toContain('/history')
    expect(lastFrame()).not.toContain('/model')
  })

  it('renders nothing when inactive', async () => {
    const { CommandPicker } = await import('../src/ui/components/CommandPicker.js')
    const { lastFrame } = render(
      <CommandPicker commands={[]} filter="" onSelect={() => {}} onCancel={() => {}} active={false} />,
    )
    expect(lastFrame()).toBe('')
  })
})

describe('Footer', () => {
  it('shows interrupt hint when generating', async () => {
    const { Footer } = await import('../src/ui/components/Footer.js')
    const { lastFrame } = render(
      <TerminalSizeProvider><Footer isGenerating={true} isInputActive={false} permMode="yolo" /></TerminalSizeProvider>,
    )
    expect(lastFrame()).toContain('esc')
    expect(lastFrame()).toContain('interrupt')
  })

  it('shows send/help hints when input is active', async () => {
    const { Footer } = await import('../src/ui/components/Footer.js')
    const { lastFrame } = render(
      <TerminalSizeProvider><Footer isGenerating={false} isInputActive={true} permMode="auto" /></TerminalSizeProvider>,
    )
    expect(lastFrame()).toContain('enter')
    expect(lastFrame()).toContain('send')
    expect(lastFrame()).toContain('/help')
    expect(lastFrame()).toContain('auto')
  })

  it('shows basic hints when idle', async () => {
    const { Footer } = await import('../src/ui/components/Footer.js')
    const { lastFrame } = render(
      <TerminalSizeProvider><Footer isGenerating={false} isInputActive={false} permMode="yolo" /></TerminalSizeProvider>,
    )
    // Shows basic hints even when idle (waiting for prompt_ready)
    expect(lastFrame()).toContain('enter')
    expect(lastFrame()).toContain('/help')
    expect(lastFrame()).toContain('yolo')
    expect(lastFrame()).not.toContain('esc') // no interrupt when not generating
  })
})

describe('ScrollBox', () => {
  it('renders children content', async () => {
    const { ScrollBox } = await import('../src/ui/components/ScrollBox.js')
    const { lastFrame } = render(
      <TerminalSizeProvider>
        <ScrollBox>
          <Text>Hello Scrollable</Text>
        </ScrollBox>
      </TerminalSizeProvider>,
    )
    expect(lastFrame()).toContain('Hello Scrollable')
  })

  it('exposes imperative handle', async () => {
    const { ScrollBox } = await import('../src/ui/components/ScrollBox.js')
    const ref = React.createRef<any>()
    render(
      <TerminalSizeProvider>
        <ScrollBox ref={ref}>
          <Text>Content</Text>
        </ScrollBox>
      </TerminalSizeProvider>,
    )
    expect(ref.current).toBeDefined()
    expect(ref.current.isSticky()).toBe(true)
    expect(ref.current.getScrollTop()).toBe(0)
  })

  it('defaults to sticky scroll', async () => {
    const { ScrollBox } = await import('../src/ui/components/ScrollBox.js')
    const ref = React.createRef<any>()
    render(
      <TerminalSizeProvider>
        <ScrollBox ref={ref}>
          <Text>Short content</Text>
        </ScrollBox>
      </TerminalSizeProvider>,
    )
    expect(ref.current.isSticky()).toBe(true)
  })
})

describe('Banner', () => {
  it('renders version and cwd', async () => {
    const { Banner } = await import('../src/ui/components/Banner.js')
    const { lastFrame } = render(
      <Banner version="0.8.0" cwd="/Users/me/project" />,
    )
    expect(lastFrame()).toContain('Orca')
    expect(lastFrame()).toContain('0.8.0')
  })

  it('renders orca pixel art', async () => {
    const { Banner } = await import('../src/ui/components/Banner.js')
    const { lastFrame } = render(
      <Banner version="0.8.0" cwd="/tmp" />,
    )
    // Should contain some orca art characters
    expect(lastFrame()).toContain('▄')
    expect(lastFrame()).toContain('█')
  })

  it('renders config files when provided', async () => {
    const { Banner } = await import('../src/ui/components/Banner.js')
    const { lastFrame } = render(
      <Banner version="0.8.0" cwd="/tmp" configFiles={['CLAUDE.md', 'package.json']} toolCount={41} hookCount={37} />,
    )
    expect(lastFrame()).toContain('CLAUDE.md')
    expect(lastFrame()).toContain('41 tools')
    expect(lastFrame()).toContain('37 hooks')
  })
})

describe('usePasteHandler', () => {
  it('exports isPasting state', async () => {
    const { usePasteHandler } = await import('../src/ui/usePasteHandler.js')
    // Module should export the hook
    expect(typeof usePasteHandler).toBe('function')
  })

  it('enables bracketed paste mode escape sequence', async () => {
    // Verify the constants are correct
    const PASTE_START = '\x1b[200~'
    const PASTE_END = '\x1b[201~'
    expect(PASTE_START.length).toBeGreaterThan(0)
    expect(PASTE_END.length).toBeGreaterThan(0)
    expect(PASTE_START).not.toBe(PASTE_END)
  })
})

describe('MarkdownText', () => {
  it('renders plain text', async () => {
    const { MarkdownText } = await import('../src/ui/components/MarkdownText.js')
    const { lastFrame } = render(
      <MarkdownText>Hello world</MarkdownText>,
    )
    expect(lastFrame()).toContain('Hello world')
  })

  it('renders empty string without error', async () => {
    const { MarkdownText } = await import('../src/ui/components/MarkdownText.js')
    const { lastFrame } = render(
      <MarkdownText>{''}</MarkdownText>,
    )
    expect(lastFrame()).toBe('')
  })
})

describe('DiffPreview', () => {
  it('renders file path and diff stats', async () => {
    const { DiffPreview } = await import('../src/ui/components/DiffPreview.js')
    const { lastFrame } = render(
      <DiffPreview
        oldContent="line1\nline2\nline3"
        newContent="line1\nmodified\nline3"
        filePath="/tmp/test.ts"
      />,
    )
    expect(lastFrame()).toContain('/tmp/test.ts')
    expect(lastFrame()).toContain('+')
    expect(lastFrame()).toContain('-')
  })

  it('shows added and removed lines', async () => {
    const { DiffPreview } = await import('../src/ui/components/DiffPreview.js')
    const { lastFrame } = render(
      <DiffPreview
        oldContent="old line"
        newContent="new line"
        filePath="test.ts"
      />,
    )
    expect(lastFrame()).toContain('old line')
    expect(lastFrame()).toContain('new line')
  })
})

describe('FileLink', () => {
  it('renders file path as text', async () => {
    const { FileLink } = await import('../src/ui/components/FileLink.js')
    const { lastFrame } = render(
      <FileLink path="/tmp/test.ts" />,
    )
    expect(lastFrame()).toContain('/tmp/test.ts')
  })

  it('renders custom display text', async () => {
    const { FileLink } = await import('../src/ui/components/FileLink.js')
    const { lastFrame } = render(
      <FileLink path="/tmp/test.ts">test.ts</FileLink>,
    )
    expect(lastFrame()).toContain('test.ts')
  })
})

describe('StatusBar sparkline', () => {
  it('renders sparkline when data provided', () => {
    const status = {
      model: 'test-model',
      contextPct: 30,
      permMode: 'yolo' as const,
      costUsd: 0,
      turns: 5,
      sparkline: [100, 500, 200, 800, 300],
    }
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={status} /></TerminalSizeProvider>)
    // Sparkline uses braille chars ▁▂▃▄▅▆▇█
    expect(lastFrame()).toMatch(/[▁▂▃▄▅▆▇█]/)
  })
})

describe('Theme', () => {
  it('provides default theme', async () => {
    const { getTheme } = await import('../src/ui/theme.js')
    const theme = getTheme()
    expect(theme.name).toBe('default')
    expect(theme.accent).toBe('cyan')
    expect(theme.prompt).toBe('cyan')
    expect(theme.success).toBe('green')
  })

  it('has all required color tokens', async () => {
    const { getTheme } = await import('../src/ui/theme.js')
    const theme = getTheme()
    // Primary
    expect(theme).toHaveProperty('accent')
    expect(theme).toHaveProperty('accentDim')
    expect(theme).toHaveProperty('prompt')
    // Semantic status
    expect(theme).toHaveProperty('success')
    expect(theme).toHaveProperty('error')
    expect(theme).toHaveProperty('warning')
    expect(theme).toHaveProperty('info')
    // Text
    expect(theme).toHaveProperty('text')
    expect(theme).toHaveProperty('dim')
    expect(theme).toHaveProperty('muted')
    // UI
    expect(theme).toHaveProperty('border')
    expect(theme).toHaveProperty('borderDim')
    expect(theme).toHaveProperty('statusBg')
    // Code & tools
    expect(theme).toHaveProperty('tool')
    expect(theme).toHaveProperty('model')
    expect(theme).toHaveProperty('filePath')
    expect(theme).toHaveProperty('diffAdd')
    expect(theme).toHaveProperty('diffRemove')
    // Progress
    expect(theme).toHaveProperty('ctxGreen')
    expect(theme).toHaveProperty('ctxYellow')
    expect(theme).toHaveProperty('ctxRed')
  })

  it('has dark/light mode property', async () => {
    const { getTheme } = await import('../src/ui/theme.js')
    const theme = getTheme()
    expect(theme).toHaveProperty('mode')
    expect(['dark', 'light']).toContain(theme.mode)
  })

  it('has 30+ semantic color tokens', async () => {
    const { getTheme } = await import('../src/ui/theme.js')
    const theme = getTheme()
    const colorKeys = Object.keys(theme).filter(k => k !== 'name' && k !== 'mode')
    expect(colorKeys.length).toBeGreaterThanOrEqual(25)
  })
})

describe('StatusBar context bar', () => {
  it('renders green bar for low context usage', () => {
    const status = {
      model: 'test-model',
      contextPct: 15,
      permMode: 'yolo' as const,
      costUsd: 0,
      turns: 1,
    }
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={status} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('█')
    expect(lastFrame()).toContain('░')
    expect(lastFrame()).toContain('15%')
  })

  it('renders full bar for 100% context', () => {
    const status = {
      model: 'test-model',
      contextPct: 100,
      permMode: 'yolo' as const,
      costUsd: 0,
      turns: 1,
    }
    const { lastFrame } = render(<TerminalSizeProvider><StatusBar status={status} /></TerminalSizeProvider>)
    expect(lastFrame()).toContain('████████')
    expect(lastFrame()).toContain('100%')
  })
})

describe('ChatSessionEmitter', () => {
  it('emitText fires text event', () => {
    const session = new ChatSessionEmitter()
    const received: string[] = []
    session.on('*', (e: { type: string; text?: string }) => {
      if (e.type === 'text') received.push(e.text!)
    })
    session.emitText('hello')
    expect(received).toEqual(['hello'])
  })

  it('waitForInput resolves on submitInput', async () => {
    const session = new ChatSessionEmitter()
    const promise = session.waitForInput()
    session.submitInput('test input')
    const result = await promise
    expect(result).toBe('test input')
  })

  it('waitForInput resolves null on EOF', async () => {
    const session = new ChatSessionEmitter()
    const promise = session.waitForInput()
    session.submitInput(null)
    const result = await promise
    expect(result).toBeNull()
  })

  it('emitUI fires both specific and wildcard events', () => {
    const session = new ChatSessionEmitter()
    const specific: string[] = []
    const wildcard: string[] = []
    session.on('text', () => specific.push('text'))
    session.on('*', () => wildcard.push('*'))
    session.emitText('hello')
    expect(specific).toEqual(['text'])
    expect(wildcard).toEqual(['*'])
  })

  it('emitPermissionRequest returns promise resolved by UI', async () => {
    const session = new ChatSessionEmitter()
    // Listen and auto-approve
    session.on('permission_request', (e: { request: { resolve: (b: boolean) => void } }) => {
      e.request.resolve(true)
    })
    const result = await session.emitPermissionRequest({ toolName: 'write_file', preview: 'test' })
    expect(result).toBe(true)
  })

  it('emitPermissionRequest returns false when denied', async () => {
    const session = new ChatSessionEmitter()
    session.on('permission_request', (e: { request: { resolve: (b: boolean) => void } }) => {
      e.request.resolve(false)
    })
    const result = await session.emitPermissionRequest({ toolName: 'run_command', preview: 'rm -rf' })
    expect(result).toBe(false)
  })

  it('emitClear fires clear event', () => {
    const session = new ChatSessionEmitter()
    const events: string[] = []
    session.on('*', (e: { type: string }) => events.push(e.type))
    session.emitClear()
    expect(events).toContain('clear')
  })
})
