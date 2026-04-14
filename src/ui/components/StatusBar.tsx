/**
 * StatusBar — CC-style 3-line status, no background colors.
 *
 * Line 1: ◇ ORCA │ model │ ██░░ ctx% │ branch
 * Line 2: cost · tok/s · turns · sparkline
 * Line 3: ▸▸ permission mode (shift+tab to cycle)
 *
 * Pure foreground text — no inverse, no backgroundColor.
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { StatusInfo } from '../types.js'
import { useTerminalSize } from '../useTerminalSize.js'
import { useTheme } from '../theme.js'

interface Props {
  status: StatusInfo
}

function miniBar(pct: number, width: number = 6): string {
  const filled = Math.round((Math.min(100, pct) / 100) * width)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

function formatCost(usd: number): string {
  if (usd <= 0) return ''
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function StatusBar({ status }: Props): React.ReactElement {
  const { cols } = useTerminalSize()
  const theme = useTheme()

  const ctxPct = Math.min(100, status.contextPct)
  const ctxColor = ctxPct > 60 ? theme.ctxRed : ctxPct > 40 ? theme.ctxYellow : theme.ctxGreen

  // Model name
  const modelShort = status.model.length > 20 ? status.model.slice(0, 18) + '..' : status.model

  // Line 2 parts
  const stats: string[] = []
  if (status.costUsd > 0) stats.push(formatCost(status.costUsd))
  if (status.tokPerSec && status.tokPerSec > 0) stats.push(`${Math.round(status.tokPerSec)} tok/s`)
  if (status.turns > 0) stats.push(`${status.turns} turns`)

  // Sparkline
  let sparkline = ''
  if (status.sparkline && status.sparkline.length > 1) {
    const sparks = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588'
    const max = Math.max(...status.sparkline, 1)
    sparkline = status.sparkline.slice(-8).map(v => sparks[Math.min(7, Math.floor((v / max) * 7))]!).join('')
  }

  // Permission
  const permLabel = status.permMode === 'yolo' ? 'bypass permissions on'
    : status.permMode === 'plan' ? 'plan mode'
    : 'auto permissions'
  const permColor = status.permMode === 'yolo' ? theme.warning
    : status.permMode === 'plan' ? theme.accent
    : theme.success

  return (
    <Box flexDirection="column" width={cols}>
      {/* Line 1 */}
      <Box>
        <Text dimColor>{'\u25C7 '}</Text>
        <Text color={theme.accent} bold>ORCA</Text>
        <Text dimColor> {'\u2502'} </Text>
        <Text>{modelShort}</Text>
        <Text dimColor> {'\u2502'} </Text>
        <Text color={ctxColor}>{miniBar(ctxPct)}</Text>
        <Text dimColor> {ctxPct}%</Text>
        {status.gitBranch && <><Text dimColor> {'\u2502'} </Text><Text dimColor>{status.gitBranch}</Text></>}
      </Box>
      {/* Line 2 */}
      {stats.length > 0 && (
        <Box>
          <Text dimColor>{stats.join('  \u00B7  ')}</Text>
          {sparkline && <Text dimColor>  {sparkline}</Text>}
        </Box>
      )}
      {/* Line 3 */}
      <Box>
        <Text color={permColor} bold>{'\u25B8\u25B8'}</Text>
        <Text color={permColor}> {permLabel}</Text>
        <Text dimColor> (shift+tab to cycle)</Text>
      </Box>
    </Box>
  )
}
