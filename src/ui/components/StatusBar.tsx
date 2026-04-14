/**
 * StatusBar — CC-style 3-line rich status display.
 *
 * Line 1: ◇ ORCA │ model │ ██░░ ctx% │ username │ branch
 * Line 2: session cost · tok/s · turns · sparkline
 * Line 3: ▸▸ permission mode (shift+tab to cycle)
 *
 * Each line rendered as a SINGLE <Text inverse> to avoid gap artifacts.
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

function padLine(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  return text + ' '.repeat(width - text.length)
}

export function StatusBar({ status }: Props): React.ReactElement {
  const { cols } = useTerminalSize()
  const theme = useTheme()

  const ctxPct = Math.min(100, status.contextPct)
  const ctxColor = ctxPct > 60 ? theme.ctxRed : ctxPct > 40 ? theme.ctxYellow : theme.ctxGreen

  // ── Line 1 ──
  const modelShort = status.model.length > 20 ? status.model.slice(0, 18) + '..' : status.model
  const parts1 = ['\u25C7 ORCA', modelShort, `${miniBar(ctxPct)} ${ctxPct}%`]
  if (status.username) parts1.push(status.username)
  if (status.gitBranch) parts1.push(status.gitBranch)
  const line1 = padLine(` ${parts1.join(' \u2502 ')} `, cols)

  // ── Line 2 ──
  const parts2: string[] = []
  if (status.costUsd > 0) parts2.push(formatCost(status.costUsd))
  if (status.tokPerSec && status.tokPerSec > 0) parts2.push(`${Math.round(status.tokPerSec)} tok/s`)
  if (status.turns > 0) parts2.push(`${status.turns} turns`)
  if (status.cachePct !== undefined && status.cachePct > 0) {
    parts2.push(`cache ${miniBar(status.cachePct, 4)} ${status.cachePct}%`)
  }
  if (status.sparkline && status.sparkline.length > 1) {
    const sparks = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588'
    const max = Math.max(...status.sparkline, 1)
    parts2.push(status.sparkline.slice(-8).map(v => sparks[Math.min(7, Math.floor((v / max) * 7))]!).join(''))
  }
  const line2 = padLine(parts2.length > 0 ? ` ${parts2.join('  \u00B7  ')} ` : ' ', cols)

  // ── Line 3: permission mode ──
  const permLabel = status.permMode === 'yolo' ? 'bypass permissions on'
    : status.permMode === 'plan' ? 'plan mode'
    : 'auto permissions'
  const permColor = status.permMode === 'yolo' ? theme.warning
    : status.permMode === 'plan' ? theme.accent
    : theme.success
  const line3 = padLine(` \u25B8\u25B8 ${permLabel} (shift+tab to cycle) `, cols)

  return (
    <Box flexDirection="column" width={cols}>
      <Text inverse>{line1}</Text>
      <Text inverse dimColor>{line2}</Text>
      <Text inverse color={permColor}>{line3}</Text>
    </Box>
  )
}
