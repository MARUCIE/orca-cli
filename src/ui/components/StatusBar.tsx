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

  const parts: string[] = [
    status.model.length > 22 ? status.model.slice(0, 20) + '..' : status.model,
    `ctx ${status.contextPct}%`,
    status.permMode,
  ]
  if (status.gitBranch) parts.push(status.gitBranch)
  if (status.costUsd > 0) {
    parts.push(status.costUsd < 0.01 ? `$${status.costUsd.toFixed(4)}` : `$${status.costUsd.toFixed(2)}`)
  }
  if (status.tokPerSec && status.tokPerSec > 0) {
    parts.push(`${status.tokPerSec} tok/s`)
  }

  const text = ` ${parts.join('  ·  ')} `
  const padding = Math.max(0, cols - text.length)

  return (
    <Box width={cols}>
      <Text inverse>{text}{' '.repeat(padding)}</Text>
    </Box>
  )
}
