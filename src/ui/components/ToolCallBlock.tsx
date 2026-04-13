/**
 * ToolCallBlock — tool invocation display with CC-style border.
 *
 * Shows tool name + args summary, then result status + duration.
 * Uses a subtle left-border accent for visual grouping.
 */

import React from 'react'
import { Box, Text } from 'ink'
import type { ToolStartInfo, ToolEndInfo } from '../types.js'

interface Props {
  start: ToolStartInfo
  end?: ToolEndInfo
}

export function ToolCallBlock({ start, end }: Props): React.ReactElement {
  const label = start.label || summarizeArgs(start.args)
  const shortLabel = label.length > 60 ? label.slice(0, 57) + '...' : label
  const borderColor = end ? (end.success ? 'green' : 'red') : 'gray'

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
        {shortLabel ? <Text dimColor> {shortLabel}</Text> : null}
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
