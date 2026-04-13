/**
 * Banner — Orca startup display as an ink component.
 *
 * Shows the pixel art orca whale + version info + config summary.
 * Rendered as a Static block (won't re-render after initial display).
 */

import React from 'react'
import { Box, Text } from 'ink'

// Orca pixel art (plain text, no ANSI — ink handles colors)
const ORCA_LINES = [
  '                   ▄▄',
  '                 ▄████▄',
  '                ████████',
  '          ▄▄▄████████████▄▄▄',
  '      ▄████████████████████████▄',
  '   ▄█████◕ ██████████████████████▄',
  '  ████████████████████████████████████████▄',
  ' █████████████████████████████████████████████',
  '  ░░░░░░░░░░░░░░░░░░░░░░░░░████████████████████',
  '    ░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████▀',
  '       ░░░░░░░░░░░░░░░░░░░░░░░░░░░░██████████▀',
  '           ░░░░░░░░░░░░░░░░░░░░░░░░░░░████▀▄██▀',
  '                ░░░░░░░░░░░░░░░░░░░░░░░░▀████▀',
  '                                         ▀████▄',
  '                                           ▀▀',
]

interface Props {
  version: string
  cwd: string
  configFiles?: string[]
  toolCount?: number
  hookCount?: number
}

export function Banner({ version, cwd, configFiles, toolCount, hookCount }: Props): React.ReactElement {
  const shortCwd = abbreviatePath(cwd)

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Orca art */}
      <Box flexDirection="column" marginLeft={2}>
        {ORCA_LINES.map((line, i) => (
          <Text key={i} color="cyan">{line}</Text>
        ))}
      </Box>

      {/* Version info */}
      <Box marginTop={1} marginLeft={2}>
        <Text bold color="white">Orca</Text>
        <Text dimColor> v{version}</Text>
        <Text dimColor>  provider-neutral agent runtime</Text>
      </Box>

      {/* Project context */}
      <Box marginLeft={2}>
        <Text color="cyan">▸</Text>
        <Text dimColor> {shortCwd}</Text>
      </Box>

      {/* Config */}
      {configFiles && configFiles.length > 0 && (
        <Box marginLeft={2}>
          <Text dimColor>config  {configFiles.join(', ')}</Text>
        </Box>
      )}

      {/* Tool/hook counts */}
      {toolCount && (
        <Box marginLeft={2}>
          <Text dimColor>
            {toolCount} tools
            {hookCount ? ` · ${hookCount} hooks` : ''}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function abbreviatePath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home && p.startsWith(home)) return '~' + p.slice(home.length)
  return p
}
