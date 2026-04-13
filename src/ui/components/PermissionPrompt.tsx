/**
 * PermissionPrompt — y/n gate for dangerous tool calls in safe mode.
 *
 * Shows tool name + preview, waits for y/n keypress, resolves the promise.
 */

import React, { useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

interface Props {
  toolName: string
  preview: string
  onResolve: (allowed: boolean) => void
  active: boolean
}

export function PermissionPrompt({ toolName, preview, onResolve, active }: Props): React.ReactElement | null {
  useInput(
    (input, key) => {
      if (!active) return
      const ch = input.toLowerCase()
      if (ch === 'y' || key.return) {
        onResolve(true)
      } else if (ch === 'n' || key.escape) {
        onResolve(false)
      }
    },
    { isActive: active },
  )

  if (!active) return null

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1} marginBottom={1}>
      <Box>
        <Text color="yellow" bold>  ? Allow </Text>
        <Text color="white" bold>{toolName}</Text>
      </Box>
      <Text dimColor>    {preview}</Text>
      <Box marginTop={1}>
        <Text dimColor>    </Text>
        <Text color="green" bold>[y]</Text>
        <Text dimColor> allow  </Text>
        <Text color="red" bold>[n]</Text>
        <Text dimColor> deny</Text>
      </Box>
    </Box>
  )
}
