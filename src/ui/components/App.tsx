/**
 * InkApp — root component for Orca CLI's terminal UI.
 *
 * Layout (flexbox column, full terminal height):
 *   ┌─────────────────────────────────┐
 *   │  Output Area (flexGrow=1)       │  ← scrollable content
 *   │  streaming text, tool calls     │
 *   ├─────────────────────────────────┤
 *   │  > input area                   │  ← user input
 *   ├─────────────────────────────────┤
 *   │  model · ctx · mode · branch    │  ← fixed status bar (inverse)
 *   └─────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, Static, useStdout } from 'ink'
import type { ChatSessionEmitter } from '../session.js'
import type { UIEvent, StatusInfo, TurnSummaryInfo, ToolStartInfo, ToolEndInfo, ModelProgress } from '../types.js'
import { StatusBar } from './StatusBar.js'
import { InputArea } from './InputArea.js'
import { ThinkingSpinner } from './ThinkingSpinner.js'
import { ToolCallBlock } from './ToolCallBlock.js'
import { TurnSummary } from './TurnSummary.js'
import { PermissionPrompt } from './PermissionPrompt.js'
import { MultiModelProgress } from './MultiModelProgress.js'
import { Footer } from './Footer.js'
import { MarkdownText } from './MarkdownText.js'
import { Banner } from './Banner.js'

export interface BannerInfo {
  version: string
  cwd: string
  configFiles?: string[]
  toolCount?: number
  hookCount?: number
}

interface Props {
  session: ChatSessionEmitter
  initialStatus: StatusInfo
  banner?: BannerInfo
}

/** A completed output block (static, won't re-render) */
interface OutputBlock {
  id: string
  type: 'text' | 'tool' | 'system'
  content: string
  toolStart?: ToolStartInfo
  toolEnd?: ToolEndInfo
  level?: 'info' | 'warn' | 'error'
}

export function App({ session, initialStatus, banner }: Props): React.ReactElement {
  const { stdout } = useStdout()
  const rows = stdout?.rows || 24

  // State
  const [status, setStatus] = useState<StatusInfo>(initialStatus)
  const [blocks, setBlocks] = useState<OutputBlock[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [inputActive, setInputActive] = useState(false)
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [lastTurnSummary, setLastTurnSummary] = useState<TurnSummaryInfo | null>(null)
  const [permRequest, setPermRequest] = useState<{ toolName: string; preview: string; resolve: (b: boolean) => void } | null>(null)
  const [multiModelState, setMultiModelState] = useState<{ command: string; models: ModelProgress[] } | null>(null)

  // Batched text streaming: accumulate tokens, flush at 20fps
  const textBuffer = useRef('')
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    flushTimer.current = setInterval(() => {
      if (textBuffer.current) {
        setStreamingText(prev => prev + textBuffer.current)
        textBuffer.current = ''
      }
    }, 50) // 20fps
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current)
    }
  }, [])

  // Subscribe to session events
  useEffect(() => {
    const blockId = () => `b${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    const handler = (event: UIEvent) => {
      switch (event.type) {
        case 'text':
          textBuffer.current += event.text
          break

        case 'thinking_start':
          setThinking(true)
          break

        case 'thinking_end':
          setThinking(false)
          break

        case 'tool_start':
          // Flush any pending streaming text as a block
          setStreamingText(prev => {
            if (prev) {
              setBlocks(b => [...b, { id: blockId(), type: 'text', content: prev }])
            }
            return ''
          })
          setBlocks(b => [...b, { id: blockId(), type: 'tool', content: '', toolStart: event.info }])
          break

        case 'tool_end':
          // Update the last tool block with result
          setBlocks(b => {
            const copy = [...b]
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i]!.type === 'tool' && copy[i]!.toolStart?.name === event.info.name && !copy[i]!.toolEnd) {
                copy[i] = { ...copy[i]!, toolEnd: event.info }
                break
              }
            }
            return copy
          })
          break

        case 'status_update':
          setStatus(event.info)
          break

        case 'system_message':
          setBlocks(b => [...b, { id: blockId(), type: 'system', content: event.text, level: event.level }])
          break

        case 'turn_summary':
          // Flush streaming text
          setStreamingText(prev => {
            if (prev) {
              setBlocks(b => [...b, { id: blockId(), type: 'text', content: prev }])
            }
            return ''
          })
          textBuffer.current = ''
          setLastTurnSummary(event.info)
          break

        case 'prompt_ready':
          // Flush any remaining text
          setStreamingText(prev => {
            if (prev) {
              setBlocks(b => [...b, { id: blockId(), type: 'text', content: prev }])
            }
            return ''
          })
          textBuffer.current = ''
          setInputActive(true)
          setMultiModelState(null)
          break

        case 'permission_request':
          setPermRequest({
            toolName: event.request.toolName,
            preview: event.request.preview,
            resolve: (allowed) => {
              event.request.resolve(allowed)
              setPermRequest(null)
            },
          })
          break

        case 'multi_model_progress':
          setMultiModelState({ command: event.command, models: event.models })
          break

        case 'multi_model_result':
          setMultiModelState(prev => {
            if (!prev) return null
            return {
              ...prev,
              models: prev.models.map(m =>
                m.model === event.model ? { ...m, done: true, elapsedMs: event.elapsedMs, output: event.output } : m,
              ),
            }
          })
          break

        case 'abort':
          setThinking(false)
          setInputActive(false)
          setPermRequest(null)
          break

        case 'clear':
          setBlocks([])
          setStreamingText('')
          textBuffer.current = ''
          setLastTurnSummary(null)
          break
      }
    }

    session.on('*', handler)
    return () => { session.removeListener('*', handler) }
  }, [session])

  // Input submission
  const handleSubmit = useCallback((text: string) => {
    if (text) {
      setInputHistory(prev => [...prev, text])
    }
    setInputActive(false)
    session.submitInput(text || null)
  }, [session])

  const handleAbort = useCallback(() => {
    session.emitAbort()
  }, [session])

  return (
    <Box flexDirection="column" height={rows}>
      {/* Output area: grows to fill available space */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {/* Banner (shown once at startup) */}
        {banner && (
          <Banner
            version={banner.version}
            cwd={banner.cwd}
            configFiles={banner.configFiles}
            toolCount={banner.toolCount}
            hookCount={banner.hookCount}
          />
        )}

        {/* Static blocks (already rendered, won't re-render) */}
        <Static items={blocks}>
          {(block) => {
            if (block.type === 'tool' && block.toolStart) {
              return (
                <Box key={block.id}>
                  <ToolCallBlock start={block.toolStart} end={block.toolEnd} />
                </Box>
              )
            }
            if (block.type === 'system') {
              const color = block.level === 'error' ? 'red' : block.level === 'warn' ? 'yellow' : 'gray'
              return <Text key={block.id} color={color}>  {block.content}</Text>
            }
            return <MarkdownText key={block.id}>{block.content}</MarkdownText>
          }}
        </Static>

        {/* Currently streaming text (raw during stream, markdown on flush) */}
        {streamingText && <Text>{streamingText}</Text>}

        {/* Thinking spinner */}
        <ThinkingSpinner active={thinking} />

        {/* Multi-model progress */}
        {multiModelState && (
          <MultiModelProgress command={multiModelState.command} models={multiModelState.models} />
        )}

        {/* Turn summary */}
        {lastTurnSummary && !thinking && !streamingText && (
          <TurnSummary info={lastTurnSummary} />
        )}

        {/* Permission prompt */}
        {permRequest && (
          <PermissionPrompt
            toolName={permRequest.toolName}
            preview={permRequest.preview}
            onResolve={permRequest.resolve}
            active={!!permRequest}
          />
        )}
      </Box>

      {/* Input area */}
      <Box>
        <InputArea
          onSubmit={handleSubmit}
          onAbort={handleAbort}
          active={inputActive && !permRequest}
          history={inputHistory}
        />
      </Box>

      {/* Fixed status bar at bottom */}
      <StatusBar status={status} />

      {/* Footer: keyboard shortcuts */}
      <Footer
        isGenerating={thinking}
        isInputActive={inputActive && !permRequest}
        permMode={status.permMode}
      />
    </Box>
  )
}
