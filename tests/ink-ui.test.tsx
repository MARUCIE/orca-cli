/**
 * Tests for ink UI components.
 *
 * Uses ink-testing-library to render components without a real terminal.
 */

import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { StatusBar } from '../src/ui/components/StatusBar.js'
import { ThinkingSpinner } from '../src/ui/components/ThinkingSpinner.js'
import { ToolCallBlock } from '../src/ui/components/ToolCallBlock.js'
import { InputArea } from '../src/ui/components/InputArea.js'
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
    const { lastFrame } = render(<StatusBar status={baseStatus} />)
    expect(lastFrame()).toContain('claude-sonnet-4.6')
  })

  it('renders context percentage', () => {
    const { lastFrame } = render(<StatusBar status={baseStatus} />)
    expect(lastFrame()).toContain('ctx 12%')
  })

  it('renders permission mode', () => {
    const { lastFrame } = render(<StatusBar status={baseStatus} />)
    expect(lastFrame()).toContain('yolo')
  })

  it('renders git branch', () => {
    const { lastFrame } = render(<StatusBar status={baseStatus} />)
    expect(lastFrame()).toContain('main')
  })

  it('renders cost', () => {
    const { lastFrame } = render(<StatusBar status={baseStatus} />)
    expect(lastFrame()).toContain('$0.0034')
  })

  it('truncates long model names', () => {
    const status = { ...baseStatus, model: 'a-very-long-model-name-that-exceeds-22-chars' }
    const { lastFrame } = render(<StatusBar status={status} />)
    expect(lastFrame()).toContain('..')
  })

  it('hides cost when zero', () => {
    const status = { ...baseStatus, costUsd: 0 }
    const { lastFrame } = render(<StatusBar status={status} />)
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
    expect(lastFrame()).toContain('Thinking')
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
    const { lastFrame } = render(<InputArea onSubmit={() => {}} active={true} />)
    expect(lastFrame()).toContain('>')
  })

  it('shows cursor when active', () => {
    const { lastFrame } = render(<InputArea onSubmit={() => {}} active={true} />)
    expect(lastFrame()).toContain('|')
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
})
