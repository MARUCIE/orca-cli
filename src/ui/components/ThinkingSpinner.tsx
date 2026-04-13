/**
 * ThinkingSpinner — animated indicator during model thinking/generation.
 */

import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'

interface Props {
  /** Whether the model is currently thinking */
  active: boolean
}

export function ThinkingSpinner({ active }: Props): React.ReactElement | null {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text dimColor> Thinking... ({elapsed}s)</Text>
    </Box>
  )
}
