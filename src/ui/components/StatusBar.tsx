/**
 * StatusBar — fixed at terminal bottom, CC-parity multi-line status.
 *
 * Line 1: model · permMode · git branch · cost · tok/s
 * Line 2: context bar ████░░░░ N% · turns · session duration · sparkline
 *
 * Rendered with inverse video (white-on-dark) like CC/Codex.
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { StatusInfo } from '../types.js'
import { useTerminalSize } from '../useTerminalSize.js'
import { useTheme } from '../theme.js'

interface Props {
  status: StatusInfo
}

export function StatusBar({ status }: Props): React.ReactElement {
  const { cols } = useTerminalSize()
  const theme = useTheme()

  // ── Line 1: model · mode · branch · cost · tok/s ──
  const modelName = status.model.length > 24 ? status.model.slice(0, 22) + '..' : status.model
  const line1Parts: string[] = [modelName, status.permMode]
  if (status.gitBranch) line1Parts.push(status.gitBranch)
  if (status.costUsd > 0) {
    line1Parts.push(status.costUsd < 0.01 ? `$${status.costUsd.toFixed(4)}` : `$${status.costUsd.toFixed(2)}`)
  }
  if (status.tokPerSec && status.tokPerSec > 0) {
    line1Parts.push(`${Math.round(status.tokPerSec)} tok/s`)
  }
  const line1Text = ` ${line1Parts.join('  ·  ')} `
  const line1Pad = Math.max(0, cols - line1Text.length)

  // ── Line 2: context bar · turns · duration · sparkline ──
  const ctxPct = Math.min(100, status.contextPct)
  const barWidth = 10
  const filled = Math.round((ctxPct / 100) * barWidth)
  const ctxBar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)
  const ctxColor = ctxPct > 60 ? theme.ctxRed : ctxPct > 40 ? theme.ctxYellow : theme.ctxGreen

  const line2Parts: string[] = []
  if (status.turns > 0) line2Parts.push(`${status.turns} turns`)

  // Sparkline
  if (status.sparkline && status.sparkline.length > 1) {
    const sparks = '▁▂▃▄▅▆▇█'
    const max = Math.max(...status.sparkline, 1)
    line2Parts.push(status.sparkline.slice(-8).map(v => sparks[Math.min(7, Math.floor((v / max) * 7))]!).join(''))
  }

  const line2Suffix = line2Parts.length > 0 ? `  ·  ${line2Parts.join('  ·  ')}` : ''
  const ctxText = ` ${ctxBar} ${ctxPct}%${line2Suffix} `
  const line2Pad = Math.max(0, cols - ctxText.length)

  return (
    <Box flexDirection="column" width={cols}>
      {/* Line 1: model info */}
      <Box>
        <Text inverse>{line1Text}{' '.repeat(line1Pad)}</Text>
      </Box>
      {/* Line 2: context + session stats */}
      <Box>
        <Text inverse color={ctxColor}>{` ${ctxBar} ${ctxPct}%`}</Text>
        <Text inverse>{line2Suffix}{' '.repeat(line2Pad)}</Text>
      </Box>
    </Box>
  )
}
