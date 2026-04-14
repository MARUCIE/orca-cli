/**
 * StatusBar — fixed at terminal bottom row.
 *
 * Displays: model · context% · permission mode · git branch · cost
 * Rendered with inverse video (white-on-dark) like Codex/vim status lines.
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import type { StatusInfo } from '../types.js'

interface Props {
  status: StatusInfo
}

export function StatusBar({ status }: Props): React.ReactElement {
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80

  // Context progress bar: ████░░░░ 42%
  const ctxPct = Math.min(100, status.contextPct)
  const barWidth = 8
  const filled = Math.round((ctxPct / 100) * barWidth)
  const ctxBar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)
  const ctxColor = ctxPct > 60 ? 'red' : ctxPct > 40 ? 'yellow' : 'green'

  const parts: string[] = [
    status.model.length > 22 ? status.model.slice(0, 20) + '..' : status.model,
  ]

  // Token sparkline: show last 8 turns as unicode braille mini-graph
  const sparkline = status.sparkline
  if (sparkline && sparkline.length > 0) {
    const sparks = '▁▂▃▄▅▆▇█'
    const max = Math.max(...sparkline, 1)
    const line = sparkline.slice(-8).map(v => sparks[Math.min(7, Math.floor((v / max) * 7))]!).join('')
    parts.push(line)
  }

  parts.push(status.permMode)
  if (status.gitBranch) parts.push(status.gitBranch)
  if (status.costUsd > 0) {
    parts.push(status.costUsd < 0.01 ? `$${status.costUsd.toFixed(4)}` : `$${status.costUsd.toFixed(2)}`)
  }
  if (status.tokPerSec && status.tokPerSec > 0) {
    parts.push(`${Math.round(status.tokPerSec)} tok/s`)
  }

  const partsText = parts.join('  ·  ')
  // Context bar is rendered with color inside inverse text
  const ctxLabel = ` ${ctxBar} ${ctxPct}%`
  const fullText = ` ${partsText}  ·  `
  const remainLen = Math.max(0, cols - fullText.length - ctxLabel.length)

  return (
    <Box width={cols}>
      <Text inverse>{fullText}</Text>
      <Text inverse color={ctxColor}>{ctxLabel}</Text>
      <Text inverse>{' '.repeat(remainLen)}</Text>
    </Box>
  )
}
