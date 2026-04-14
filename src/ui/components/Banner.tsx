/**
 * Banner — Codex-inspired startup display with bordered session info.
 *
 * Layout:
 * ┌─────────────────────────────────────────────┐
 * │  >_ Orca CLI (v0.8.0)                       │
 * │                                              │
 * │    Model:        claude-sonnet-4.6           │
 * │    Directory:    ~/Projects/orca-cli         │
 * │    Permissions:  auto                        │
 * │    Tools:        41 tools · 57 hooks         │
 * │    Config:       CLAUDE.md, settings.json    │
 * │    Session:      abc123...                   │
 * └─────────────────────────────────────────────┘
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { useTerminalSize } from '../useTerminalSize.js'
import { getFleetSummaryLine } from '../../fleet-env.js'

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

  // Build key-value rows
  const rows: Array<[string, string]> = []
  if (model) rows.push(['Model:', model])
  rows.push(['Directory:', shortCwd])
  if (permMode) rows.push(['Permissions:', permMode === 'yolo' ? 'Full Access (yolo)' : permMode === 'plan' ? 'Plan Mode' : 'Auto'])
  if (toolCount) {
    const toolStr = hookCount ? `${toolCount} tools \u00B7 ${hookCount} hooks` : `${toolCount} tools`
    rows.push(['Tools:', toolStr])
  }
  if (configFiles && configFiles.length > 0) {
    rows.push(['Config:', configFiles.join(', ')])
  }
  if (sessionId) {
    rows.push(['Session:', sessionId.length > 24 ? sessionId.slice(0, 22) + '..' : sessionId])
  }
  const fleetLine = getFleetSummaryLine()
  if (fleetLine) {
    rows.push(['Fleet:', fleetLine])
  }

  const boxWidth = Math.min(cols - 4, 64)
  const labelWidth = 18

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        width={boxWidth}
        marginLeft={2}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Title line */}
        <Box marginBottom={1}>
          <Text color={theme.accent} bold>{'>_ '}</Text>
          <Text bold>Orca CLI</Text>
          <Text dimColor> (v{version})</Text>
        </Box>

        {/* Key-value rows */}
        {rows.map(([label, value], i) => (
          <Box key={i}>
            <Text dimColor>{label.padEnd(labelWidth)}</Text>
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
