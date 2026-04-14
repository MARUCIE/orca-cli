/**
 * Banner — Orca startup display with swimming animation.
 *
 * The orca swims in from the right side, body-wave undulation,
 * then settles at its final position. Uses React state for frame animation.
 */

import React, { useState, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme.js'

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

const ART_WIDTH = Math.max(...ORCA_LINES.map(l => l.length))

interface Props {
  version: string
  cwd: string
  configFiles?: string[]
  toolCount?: number
  hookCount?: number
}

export function Banner({ version, cwd, configFiles, toolCount, hookCount }: Props): React.ReactElement {
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
  const shortCwd = abbreviatePath(cwd)
  const theme = useTheme()

  // Animation state
  const totalFrames = 20
  const canAnimate = cols > ART_WIDTH + 10
  const [frame, setFrame] = useState(canAnimate ? 0 : totalFrames)

  useEffect(() => {
    if (!canAnimate || frame >= totalFrames) return
    const timer = setTimeout(() => setFrame(f => f + 1), 60)
    return () => clearTimeout(timer)
  }, [frame, canAnimate])

  // Calculate per-line offsets
  const maxPad = Math.max(0, cols - ART_WIDTH - 4)
  const startPad = maxPad
  const endPad = 2
  const progress = Math.min(1, frame / totalFrames)
  const ease = 1 - Math.pow(1 - progress, 3) // cubic ease-out
  const baseDrift = Math.round(startPad + (endPad - startPad) * ease)

  // Body-wave undulation
  const t = (frame / totalFrames) * Math.PI * 4
  const amplitude = Math.min(Math.floor(maxPad / 6), 8)
  const dampFactor = 1 - progress * 0.8
  const globalWave = Math.round(Math.sin(t) * amplitude * dampFactor)

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Orca art with animation offsets */}
      <Box flexDirection="column">
        {ORCA_LINES.map((line, i) => {
          // Per-line body wave (tail sways more than head)
          const tailFactor = 0.3 + (i / ORCA_LINES.length) * 0.7
          const bodyWave = Math.round(Math.sin(t + i * 0.45) * 3 * tailFactor * dampFactor)
          const pad = Math.max(0, Math.min(maxPad, baseDrift + globalWave + bodyWave))
          return (
            <Text key={i} color={theme.accent}>{' '.repeat(pad)}{line}</Text>
          )
        })}
      </Box>

      {/* Version info */}
      <Box marginTop={1} marginLeft={2}>
        <Text bold color="white">Orca</Text>
        <Text dimColor> v{version}</Text>
        <Text dimColor>  provider-neutral agent runtime</Text>
      </Box>

      {/* Project context */}
      <Box marginLeft={2}>
        <Text color={theme.accent}>▸</Text>
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
