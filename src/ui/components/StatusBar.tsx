/**
 * StatusBar — CC-style 3-line rich status display.
 *
 * Line 1: ◇ ORCA │ model │ ██░░ ctx% │ username │ permLevel
 * Line 2: session ██░░ cost · tok/s │ turns · sparkline
 * Line 3: ▸▸ permission mode (shift+tab to cycle)
 *
 * Inverse video background, progress bars with color thresholds.
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { StatusInfo } from '../types.js'
import { useTerminalSize } from '../useTerminalSize.js'
import { useTheme } from '../theme.js'

interface Props {
  status: StatusInfo
}

/** Render a compact progress bar: ████░░░░ */
function miniBar(pct: number, width: number = 8): string {
  const filled = Math.round((Math.min(100, pct) / 100) * width)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

/** Format elapsed seconds as Hh Mm or Mm Ss */
function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60 > 0 ? `${secs % 60}s` : ''}`
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h${m > 0 ? `${m}m` : ''}`
}

/** Format cost as compact string */
function formatCost(usd: number): string {
  if (usd <= 0) return ''
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

export function StatusBar({ status }: Props): React.ReactElement {
  const { cols } = useTerminalSize()
  const theme = useTheme()

  const ctxPct = Math.min(100, status.contextPct)
  const ctxColor = ctxPct > 60 ? theme.ctxRed : ctxPct > 40 ? theme.ctxYellow : theme.ctxGreen

  // ── Line 1: product + model + context + user + level ──
  const modelShort = status.model.length > 20 ? status.model.slice(0, 18) + '..' : status.model
  const parts1: string[] = []
  parts1.push(`\u25C7 ORCA`)
  parts1.push(modelShort)

  const line1Left = ` ${parts1.join(' \u2502 ')} \u2502 `
  const line1CtxBar = `${miniBar(ctxPct, 6)} ${ctxPct}%`
  const line1Right: string[] = []
  if (status.username) line1Right.push(status.username)
  if (status.permLevel) line1Right.push(status.permLevel)
  if (status.gitBranch) line1Right.push(status.gitBranch)
  const line1RightStr = line1Right.length > 0 ? ` \u2502 ${line1Right.join(' \u2502 ')}` : ''
  const line1Full = line1Left + line1CtxBar + line1RightStr
  const line1Pad = Math.max(0, cols - line1Full.length - 1)

  // ── Line 2: session stats + sparkline ──
  const parts2: string[] = []
  if (status.costUsd > 0) parts2.push(formatCost(status.costUsd))
  if (status.tokPerSec && status.tokPerSec > 0) parts2.push(`${Math.round(status.tokPerSec)} tok/s`)
  if (status.turns > 0) parts2.push(`${status.turns} turns`)
  if (status.sessionElapsed && status.sessionElapsed > 0) parts2.push(formatElapsed(status.sessionElapsed))
  if (status.cachePct !== undefined && status.cachePct > 0) {
    parts2.push(`cache ${miniBar(status.cachePct, 4)} ${status.cachePct}%`)
  }
  // Sparkline
  if (status.sparkline && status.sparkline.length > 1) {
    const sparks = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588'
    const max = Math.max(...status.sparkline, 1)
    parts2.push(status.sparkline.slice(-8).map(v => sparks[Math.min(7, Math.floor((v / max) * 7))]!).join(''))
  }
  const line2Text = parts2.length > 0 ? ` ${parts2.join('  \u00B7  ')} ` : ' '
  const line2Pad = Math.max(0, cols - line2Text.length)

  // ── Line 3: permission mode indicator ──
  const permLabel = status.permMode === 'yolo' ? 'bypass permissions on'
    : status.permMode === 'plan' ? 'plan mode'
    : 'auto permissions'
  const line3Text = ` \u25B8\u25B8 ${permLabel} (shift+tab to cycle) `
  const line3Pad = Math.max(0, cols - line3Text.length)
  const permColor = status.permMode === 'yolo' ? theme.warning
    : status.permMode === 'plan' ? theme.accent
    : theme.success

  return (
    <Box flexDirection="column" width={cols}>
      {/* Line 1: product + model + context */}
      <Box>
        <Text inverse>{line1Left}</Text>
        <Text inverse color={ctxColor}>{line1CtxBar}</Text>
        <Text inverse>{line1RightStr}{' '.repeat(line1Pad)} </Text>
      </Box>
      {/* Line 2: session stats */}
      <Box>
        <Text inverse dimColor>{line2Text}{' '.repeat(line2Pad)}</Text>
      </Box>
      {/* Line 3: permission mode */}
      <Box>
        <Text inverse color={permColor}>{line3Text}</Text>
        <Text inverse>{' '.repeat(line3Pad)}</Text>
      </Box>
    </Box>
  )
}
