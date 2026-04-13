/**
 * MultiModelProgress — live progress for council/race/pipeline commands.
 *
 * Shows each model's status (thinking/done) with elapsed time.
 */

import React from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { ModelProgress } from '../types.js'

interface Props {
  command: string
  models: ModelProgress[]
}

export function MultiModelProgress({ command, models }: Props): React.ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="cyan" bold>  {command}</Text>
        <Text dimColor> — {models.length} models</Text>
      </Box>
      {models.map((m) => (
        <Box key={m.model} marginLeft={2}>
          {m.done ? (
            <Text color="green">  ok </Text>
          ) : (
            <Text color="cyan">
              <Spinner type="dots" />{' '}
            </Text>
          )}
          <Text>{m.model.length > 20 ? m.model.slice(0, 18) + '..' : m.model}</Text>
          <Text dimColor> {(m.elapsedMs / 1000).toFixed(1)}s</Text>
        </Box>
      ))}
    </Box>
  )
}
