/**
 * ToolCallBlock — tool invocation display with CC-style border.
 *
 * Shows tool name + args summary, then result status + duration.
 * Uses a subtle left-border accent for visual grouping.
 * File paths render as OSC 8 clickable links when terminal supports it.
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { ToolStartInfo, ToolEndInfo } from '../types.js'
import { FileLink } from './FileLink.js'
import { truncateLabel } from '../utils.js'

interface Props {
  start: ToolStartInfo
  end?: ToolEndInfo
}

export function ToolCallBlock({ start, end }: Props): React.ReactElement {
  const borderColor = end ? (end.success ? 'green' : 'red') : 'gray'
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
        <Text color="yellow" bold>{start.name}</Text>
        {hasPath ? (
          <Text> <FileLink path={String(start.args.path)} color="gray" /></Text>
        ) : shortLabel ? (
          <Text dimColor> {shortLabel}</Text>
        ) : null}
      </Box>
      {end && (
        <Box>
          <Text color={end.success ? 'green' : 'red'}>
            {end.success ? 'ok' : 'error'}
          </Text>
          <Text dimColor> {(end.durationMs / 1000).toFixed(1)}s</Text>
          {!end.success && end.output && (
            <Text color="red"> {end.output.slice(0, 80)}</Text>
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
