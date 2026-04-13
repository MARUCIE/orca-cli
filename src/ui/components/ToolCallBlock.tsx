/**
 * ToolCallBlock — displays a tool invocation and its result.
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

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text dimColor>  . </Text>
        <Text color="yellow">{start.name}</Text>
        {shortLabel && <Text dimColor>({shortLabel})</Text>}
        {end && (
          <>
            <Text> </Text>
            <Text color={end.success ? 'green' : 'red'}>{end.success ? 'ok' : 'err'}</Text>
            <Text dimColor> {(end.durationMs / 1000).toFixed(1)}s</Text>
          </>
        )}
      </Box>
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
