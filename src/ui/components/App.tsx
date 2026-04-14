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
import { useTheme } from '../theme.js'
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
import { CommandPicker } from './CommandPicker.js'
import { DiffPreview } from './DiffPreview.js'
import type { CommandDef } from './CommandPicker.js'

const SLASH_COMMANDS: CommandDef[] = [
  { name: '/help', description: 'Show all commands' },
  { name: '/clear', description: 'Clear conversation' },
  { name: '/compact', description: 'Smart compaction' },
  { name: '/status', description: 'Session overview' },
  { name: '/cost', description: 'Token breakdown' },
  { name: '/model', description: 'Show/switch model' },
  { name: '/models', description: 'List all models' },
  { name: '/effort', description: 'Thinking effort' },
  { name: '/mode', description: 'Behavioral profiles' },
  { name: '/diff', description: 'Show git diff' },
  { name: '/commit', description: 'Create commit' },
  { name: '/undo', description: 'Revert last write' },
  { name: '/council', description: 'Multi-model council' },
  { name: '/race', description: 'First answer wins' },
  { name: '/pipeline', description: 'Plan-Code-Review' },
  { name: '/mission', description: 'Autonomous mission' },
  { name: '/plan', description: 'Task decomposition' },
  { name: '/notes', description: 'Observations' },
  { name: '/mcp', description: 'MCP servers' },
  { name: '/hooks', description: 'Registered hooks' },
  { name: '/doctor', description: 'Health check' },
  { name: '/save', description: 'Save session' },
  { name: '/thread', description: 'Conversation memory' },
  { name: '/providers', description: 'List providers' },
]

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

/** Active tool call with animated spinner — lives outside <Static> so it can re-render */
function ActiveToolCall({ start, startTime }: { start: ToolStartInfo; startTime: number }): React.ReactElement {
  const [elapsed, setElapsed] = useState(0)
  const theme = useTheme()
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - startTime), 100)
    return () => clearInterval(timer)
  }, [startTime])

  const label = start.label || summarizeToolArgs(start.args)
  const shortLabel = label.length > 60 ? label.slice(0, 57) + '...' : label

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={theme.accent}
      paddingLeft={1}
      marginLeft={1}
    >
      <Box>
        <Text color="yellow" bold>{start.name}</Text>
        {shortLabel ? <Text dimColor> {shortLabel}</Text> : null}
      </Box>
      <Box>
        <Text color={theme.accent}>{'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(elapsed / 80) % 10]}</Text>
        <Text dimColor> {(elapsed / 1000).toFixed(1)}s</Text>
      </Box>
    </Box>
  )
}

function summarizeToolArgs(args: Record<string, unknown>): string {
  if ('path' in args) return String(args.path)
  if ('command' in args) {
    const cmd = String(args.command)
    return cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd
  }
  if ('query' in args) return String(args.query).slice(0, 50)
  return ''
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
  const [permRequest, setPermRequest] = useState<{
    toolName: string; preview: string; resolve: (b: boolean) => void
    diff?: { filePath: string; oldContent: string; newContent: string }
  } | null>(null)
  const [multiModelState, setMultiModelState] = useState<{ command: string; models: ModelProgress[] } | null>(null)
  const [activeTool, setActiveTool] = useState<{ id: string; start: ToolStartInfo; startTime: number } | null>(null)
  const [inputValue, setInputValue] = useState('')

  // Command picker state
  const showPicker = inputActive && inputValue.startsWith('/') && inputValue.length > 0
  const pickerFilter = inputValue.slice(1) // strip leading /

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
          // Keep active tool in dynamic area (not Static) so spinner animates
          setActiveTool({ id: blockId(), start: event.info, startTime: Date.now() })
          break

        case 'tool_end':
          // Move completed tool from active area into Static blocks
          setActiveTool(prev => {
            if (prev) {
              setBlocks(b => [...b, { id: prev.id, type: 'tool', content: '', toolStart: prev.start, toolEnd: event.info }])
            }
            return null
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
            diff: event.request.diff,
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

        case 'session_end': {
          const si = event.info
          const dur = (si.totalDuration / 1000).toFixed(0)
          const tokens = si.totalInputTokens + si.totalOutputTokens
          const cost = si.totalCostUsd > 0
            ? (si.totalCostUsd < 0.01 ? `${(si.totalCostUsd * 100).toFixed(1)}c` : `$${si.totalCostUsd.toFixed(2)}`)
            : ''
          const summary = [`${si.turns} turns · ${tokens.toLocaleString()} tokens · ${dur}s`, cost].filter(Boolean).join(' · ')
          setBlocks(b => [...b, { id: blockId(), type: 'system', content: summary, level: 'info' }])
          break
        }

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

  // Input value tracking (for command picker)
  const handleInputChange = useCallback((val: string) => {
    setInputValue(val)
  }, [])

  // Command picker selection
  const handleCommandSelect = useCallback((command: string) => {
    // Submit the selected command
    setInputHistory(prev => [...prev, command])
    setInputActive(false)
    setInputValue('')
    session.submitInput(command)
  }, [session])

  const handleCommandCancel = useCallback(() => {
    setInputValue('')
  }, [])

  // Input submission
  const handleSubmit = useCallback((text: string) => {
    if (text) {
      setInputHistory(prev => [...prev, text])
    }
    setInputActive(false)
    setInputValue('')
    session.submitInput(text || null)
  }, [session])

  const handleAbort = useCallback(() => {
    session.emitAbort()
  }, [session])

  const handleClear = useCallback(() => {
    session.emitCommand('clear-screen')
    setBlocks([])
    setStreamingText('')
    textBuffer.current = ''
    setLastTurnSummary(null)
  }, [session])

  const handleModeCycle = useCallback(() => {
    session.emitCommand('mode-cycle')
  }, [session])

  const handleUndo = useCallback(() => {
    session.emitCommand('undo')
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

        {/* Active tool call with spinner (not in Static — re-renders) */}
        {activeTool && (
          <ActiveToolCall start={activeTool.start} startTime={activeTool.startTime} />
        )}

        {/* Thinking spinner */}
        <ThinkingSpinner active={thinking && !activeTool} />

        {/* Multi-model progress */}
        {multiModelState && (
          <MultiModelProgress command={multiModelState.command} models={multiModelState.models} />
        )}

        {/* Turn summary */}
        {lastTurnSummary && !thinking && !streamingText && (
          <TurnSummary info={lastTurnSummary} />
        )}

        {/* Diff preview + Permission prompt */}
        {permRequest && permRequest.diff && (
          <DiffPreview
            filePath={permRequest.diff.filePath}
            oldContent={permRequest.diff.oldContent}
            newContent={permRequest.diff.newContent}
          />
        )}
        {permRequest && (
          <PermissionPrompt
            toolName={permRequest.toolName}
            preview={permRequest.preview}
            onResolve={permRequest.resolve}
            active={!!permRequest}
          />
        )}
      </Box>

      {/* Command picker (above input box, like autocomplete dropdown) */}
      {showPicker && (
        <CommandPicker
          commands={SLASH_COMMANDS}
          filter={pickerFilter}
          onSelect={handleCommandSelect}
          onCancel={handleCommandCancel}
          active={showPicker}
        />
      )}

      {/* Input area */}
      <Box>
        <InputArea
          onSubmit={handleSubmit}
          onAbort={handleAbort}
          onClear={handleClear}
          onModeCycle={handleModeCycle}
          onUndo={handleUndo}
          onChange={handleInputChange}
          active={inputActive && !permRequest}
          pickerActive={showPicker}
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
