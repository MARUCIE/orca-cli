/**
 * Banner — Orca art + Codex-style bordered session info.
 *
 * Top: Swimming orca pixel art (animated)
 * Bottom: Bordered info box with session details (Codex-style)
 */

import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { useTerminalSize } from '../useTerminalSize.js'

// Orca pixel art (compact version — 8 lines)
const ORCA_LINES = [
  '            \u2584\u2584',
  '          \u2584\u2588\u2588\u2588\u2588\u2584',
  '    \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584',
  '  \u2584\u2588\u2588\u2588\u25D5 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584',
  ' \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584',
  '  \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580',
  '     \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2588\u2588\u2588\u2580\u2584\u2588\u2580',
  '          \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2580\u2588\u2588\u2588\u2580',
]

interface Props {
  version: string
  cwd: string
  configFiles?: string[]
  toolCount?: number
  hookCount?: number
  model?: string
  permMode?: string
  sessionId?: string
}

export function Banner({ version, cwd, configFiles, toolCount, hookCount, model, permMode, sessionId }: Props): React.ReactElement {
  const { cols } = useTerminalSize()
  const theme = useTheme()
  const shortCwd = abbreviatePath(cwd)

  // Swim animation
  const totalFrames = 16
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (frame >= totalFrames) return
    const timer = setTimeout(() => setFrame(f => f + 1), 50)
    return () => clearTimeout(timer)
  }, [frame])

  const progress = Math.min(1, frame / totalFrames)
  const ease = 1 - Math.pow(1 - progress, 3)
  const maxDrift = Math.max(0, cols - 30)
  const drift = Math.round(maxDrift * (1 - ease))

  // Info rows
  const rows: Array<[string, string]> = []
  if (model) rows.push(['Model:', model])
  rows.push(['Directory:', shortCwd])
  if (permMode) rows.push(['Permissions:', permMode === 'yolo' ? 'Full Access' : permMode === 'plan' ? 'Plan Mode' : 'Auto'])
  if (toolCount) {
    const toolStr = hookCount ? `${toolCount} tools \u00B7 ${hookCount} hooks` : `${toolCount} tools`
    rows.push(['Tools:', toolStr])
  }
  if (configFiles && configFiles.length > 0) {
    rows.push(['Config:', configFiles.join(', ')])
  }
  if (sessionId) {
    rows.push(['Session:', sessionId.length > 20 ? sessionId.slice(0, 18) + '..' : sessionId])
  }

  let fleetLine: string | null = null
  try {
    const { getFleetSummaryLine } = require('../../fleet-env.js') as { getFleetSummaryLine: () => string | null }
    fleetLine = getFleetSummaryLine()
  } catch {}
  if (fleetLine) rows.push(['Fleet:', fleetLine])

  const boxWidth = Math.min(cols - 4, 60)

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Orca pixel art with swim animation */}
      <Box flexDirection="column">
        {ORCA_LINES.map((line, i) => {
          const wave = Math.round(Math.sin((frame / totalFrames) * Math.PI * 3 + i * 0.4) * 2 * (1 - progress))
          const pad = Math.max(0, Math.min(maxDrift, drift + wave))
          return <Text key={i} color={theme.accent}>{' '.repeat(pad)}{line}</Text>
        })}
      </Box>

      {/* Codex-style info box */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        width={boxWidth}
        marginLeft={2}
        marginTop={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <Box marginBottom={1}>
          <Text color={theme.accent} bold>{'>_ '}</Text>
          <Text bold>Orca CLI</Text>
          <Text dimColor> (v{version})</Text>
        </Box>
        {rows.map(([label, value], i) => (
          <Box key={i}>
            <Text dimColor>{label.padEnd(16)}</Text>
            <Text>{value}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function abbreviatePath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home && p.startsWith(home)) return '~' + p.slice(home.length)
  return p
}
