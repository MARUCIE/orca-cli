/**
 * TurnSummary — compact post-turn metrics display.
 *
 * Shows: elapsed · tokens · cost
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { TurnSummaryInfo } from '../types.js'

interface Props {
  info: TurnSummaryInfo
}

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

export function TurnSummary({ info }: Props): React.ReactElement {
  const sec = (info.duration / 1000).toFixed(1)
  const cost = info.costUsd >= 0.01 ? `$${info.costUsd.toFixed(2)}` : `$${info.costUsd.toFixed(4)}`
  const tokPerSec = info.duration > 0 ? Math.round((info.outputTokens / info.duration) * 1000) : 0

  return (
    <Box marginLeft={2}>
      <Text dimColor>
        {'  '}r {sec}s · d {fmtTok(info.inputTokens)} u {fmtTok(info.outputTokens)} · {cost} · {tokPerSec} tok/s
      </Text>
    </Box>
  )
}
