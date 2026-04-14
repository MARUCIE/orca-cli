/**
 * ToolCallBlock — tool invocation display with CC-style border.
 *
 * Shows tool name + args summary, then result status + duration.
 * Graduated error rendering: different visual treatment per error type.
 * File paths render as OSC 8 clickable links when terminal supports it.
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { ToolStartInfo, ToolEndInfo } from '../types.js'
import { FileLink } from './FileLink.js'
import { truncateLabel } from '../utils.js'
import { useTheme } from '../theme.js'

interface Props {
  start: ToolStartInfo
  end?: ToolEndInfo
}

/** Map error type to user-facing label + icon */
function getErrorDisplay(end: ToolEndInfo): { label: string; icon: string } {
  if (end.success) return { label: 'ok', icon: '' }
  switch (end.errorType) {
    case 'rejected':   return { label: 'rejected', icon: '✗' }
    case 'permission': return { label: 'denied', icon: '🔒' }
    case 'timeout':    return { label: 'timeout', icon: '⏱' }
    case 'not_found':  return { label: 'not found', icon: '?' }
    case 'validation': return { label: 'invalid', icon: '!' }
    default:           return { label: 'error', icon: '✗' }
  }
}

export function ToolCallBlock({ start, end }: Props): React.ReactElement {
  const theme = useTheme()
  const borderColor = end ? (end.success ? theme.success : theme.error) : theme.dim
  const hasPath = 'path' in start.args && typeof start.args.path === 'string'
  const label = start.label || summarizeArgs(start.args)
  const shortLabel = truncateLabel(label)

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={borderColor}
      paddingLeft={1}
      marginLeft={1}
    >
      <Box>
        <Text color={theme.tool} bold>{start.name}</Text>
        {hasPath ? (
          <Text> <FileLink path={String(start.args.path)} color={theme.filePath} /></Text>
        ) : shortLabel ? (
          <Text dimColor> {shortLabel}</Text>
        ) : null}
      </Box>
      {end && (
        <Box flexDirection="column">
          <Box>
            {end.success ? (
              <Text color={theme.success}>ok</Text>
            ) : (
              <>
                <Text color={theme.error}>{getErrorDisplay(end).icon} {getErrorDisplay(end).label}</Text>
              </>
            )}
            <Text dimColor> {(end.durationMs / 1000).toFixed(1)}s</Text>
          </Box>
          {!end.success && end.output && (
            <Box marginLeft={1}>
              <Text color={end.errorType === 'rejected' ? theme.warning : theme.error}>
                {end.output.slice(0, 120)}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

function summarizeArgs(args: Record<string, unknown>): string {
  if ('path' in args) return String(args.path)
  if ('command' in args) {
    const cmd = String(args.command)
    return cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd
  }
  if ('query' in args) return String(args.query).slice(0, 50)
  return ''
}
