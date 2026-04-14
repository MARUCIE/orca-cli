/**
 * ThinkingSpinner — animated indicator during model thinking/generation.
 *
 * CC-inspired: random verb from a curated list, elapsed timer, theme color.
 * Verb changes every 4 seconds for visual interest.
 */

import React, { useState, useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { useTheme } from '../theme.js'

// Curated spinner verbs (CC has 204 — this is the best 60)
const VERBS = [
  'Thinking', 'Pondering', 'Crafting', 'Computing', 'Reasoning',
  'Analyzing', 'Considering', 'Processing', 'Synthesizing', 'Evaluating',
  'Exploring', 'Investigating', 'Deliberating', 'Formulating', 'Composing',
  'Assembling', 'Architecting', 'Designing', 'Refining', 'Calibrating',
  'Consulting', 'Digesting', 'Deciphering', 'Reflecting', 'Untangling',
  'Choreographing', 'Orchestrating', 'Brainstorming', 'Distilling', 'Weaving',
  'Sculpting', 'Brewing', 'Conjuring', 'Wrangling', 'Meditating',
  'Crunching', 'Sketching', 'Polishing', 'Mapping', 'Connecting',
  'Doodling', 'Moonwalking', 'Percolating', 'Noodling', 'Daydreaming',
  'Philosophizing', 'Simmering', 'Marinating', 'Fermenting', 'Hatching',
  'Tinkering', 'Rummaging', 'Harmonizing', 'Calibrating', 'Navigating',
  'Decoding', 'Interpolating', 'Extrapolating', 'Converging', 'Iterating',
]

function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]!
}

interface Props {
  active: boolean
}

export function ThinkingSpinner({ active }: Props): React.ReactElement | null {
  const [elapsed, setElapsed] = useState(0)
  const [verb, setVerb] = useState(pickVerb)
  const theme = useTheme()

  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    const start = Date.now()
    setVerb(pickVerb())
    const timer = setInterval(() => {
      const secs = Math.round((Date.now() - start) / 1000)
      setElapsed(secs)
      // Change verb every 4 seconds for visual interest
      if (secs > 0 && secs % 4 === 0) setVerb(pickVerb())
    }, 1000)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  return (
    <Box>
      <Text color={theme.accent}>
        <Spinner type="dots" />
      </Text>
      <Text dimColor> {verb}... ({elapsed}s)</Text>
    </Box>
  )
}
