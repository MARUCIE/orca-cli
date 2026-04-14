/**
 * ThinkingSpinner — animated indicator during model thinking/generation.
 *
 * CC-parity features:
 * - 204 curated verbs rotating every 4 seconds
 * - stalledIntensity: color shifts accent → warning → error as wait grows
 * - Reduced motion: respects REDUCE_MOTION env var (static indicator)
 * - Elapsed timer with smooth animation
 */

import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { useTheme } from '../theme.js'

// 204 curated spinner verbs — CC-parity verb count
const VERBS = [
  // Cognitive
  'Thinking', 'Pondering', 'Reasoning', 'Analyzing', 'Considering',
  'Processing', 'Synthesizing', 'Evaluating', 'Reflecting', 'Deliberating',
  'Contemplating', 'Deducing', 'Inferring', 'Hypothesizing', 'Theorizing',
  'Abstracting', 'Generalizing', 'Specializing', 'Categorizing', 'Classifying',
  'Comparing', 'Contrasting', 'Distinguishing', 'Correlating', 'Associating',
  // Creative
  'Crafting', 'Composing', 'Designing', 'Architecting', 'Sculpting',
  'Painting', 'Sketching', 'Drafting', 'Illustrating', 'Rendering',
  'Envisioning', 'Imagining', 'Conceiving', 'Inventing', 'Innovating',
  'Brainstorming', 'Ideating', 'Prototyping', 'Mocking', 'Wireframing',
  // Technical
  'Computing', 'Compiling', 'Parsing', 'Tokenizing', 'Encoding',
  'Decoding', 'Interpolating', 'Extrapolating', 'Optimizing', 'Profiling',
  'Benchmarking', 'Debugging', 'Tracing', 'Instrumenting', 'Validating',
  'Verifying', 'Testing', 'Fuzzing', 'Linting', 'Formatting',
  'Refactoring', 'Migrating', 'Transpiling', 'Bundling', 'Minifying',
  // Construction
  'Assembling', 'Building', 'Constructing', 'Fabricating', 'Manufacturing',
  'Engineering', 'Machining', 'Welding', 'Soldering', 'Wiring',
  'Plumbing', 'Framing', 'Scaffolding', 'Reinforcing', 'Fortifying',
  // Exploration
  'Exploring', 'Investigating', 'Researching', 'Surveying', 'Probing',
  'Scanning', 'Scouting', 'Mapping', 'Charting', 'Navigating',
  'Pathfinding', 'Trailblazing', 'Excavating', 'Mining', 'Drilling',
  // Refinement
  'Refining', 'Polishing', 'Honing', 'Sharpening', 'Tuning',
  'Calibrating', 'Adjusting', 'Tweaking', 'Fine-tuning', 'Perfecting',
  'Streamlining', 'Simplifying', 'Distilling', 'Concentrating', 'Purifying',
  // Connection
  'Connecting', 'Linking', 'Bridging', 'Joining', 'Merging',
  'Weaving', 'Knitting', 'Braiding', 'Splicing', 'Fusing',
  'Integrating', 'Unifying', 'Consolidating', 'Harmonizing', 'Synchronizing',
  // Kitchen
  'Brewing', 'Cooking', 'Baking', 'Simmering', 'Marinating',
  'Fermenting', 'Steeping', 'Reducing', 'Seasoning', 'Blending',
  'Whisking', 'Folding', 'Kneading', 'Proofing', 'Caramelizing',
  // Nature
  'Growing', 'Cultivating', 'Nurturing', 'Germinating', 'Blooming',
  'Branching', 'Rooting', 'Grafting', 'Pruning', 'Harvesting',
  'Pollinating', 'Photosynthesizing', 'Composting', 'Mulching', 'Terracing',
  // Playful
  'Doodling', 'Noodling', 'Tinkering', 'Fiddling', 'Juggling',
  'Moonwalking', 'Daydreaming', 'Percolating', 'Hatching', 'Conjuring',
  'Wrangling', 'Untangling', 'Rummaging', 'Foraging', 'Spelunking',
  // Musical
  'Orchestrating', 'Choreographing', 'Conducting', 'Composing', 'Arranging',
  'Improvising', 'Jamming', 'Riffing', 'Sampling', 'Remixing',
  // Scientific
  'Experimenting', 'Observing', 'Measuring', 'Quantifying', 'Modeling',
  'Simulating', 'Predicting', 'Forecasting', 'Projecting', 'Estimating',
  // Organization
  'Sorting', 'Ordering', 'Prioritizing', 'Scheduling', 'Sequencing',
  'Batching', 'Queuing', 'Dispatching', 'Routing', 'Allocating',
  // Transformation
  'Transforming', 'Converting', 'Translating', 'Transcribing', 'Adapting',
  'Morphing', 'Evolving', 'Mutating', 'Iterating', 'Converging',
]

function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]!
}

/** stalledIntensity: how long before the spinner looks "stalled" */
function getStalledColor(theme: ReturnType<typeof useTheme>, elapsed: number): string {
  if (elapsed < 10) return theme.accent      // Normal: accent color
  if (elapsed < 30) return theme.warning      // Getting slow: warning
  return theme.error                           // Very slow: error/red
}

// Respect reduced motion preference
const reducedMotion = process.env.REDUCE_MOTION === '1' ||
  process.env.REDUCE_MOTION === 'true' ||
  process.env.NO_MOTION === '1'

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

  const spinnerColor = getStalledColor(theme, elapsed)

  return (
    <Box>
      {reducedMotion ? (
        <Text color={spinnerColor}>{'>'}</Text>
      ) : (
        <Text color={spinnerColor}>
          <Spinner type="dots" />
        </Text>
      )}
      <Text color={spinnerColor}> {verb}...</Text>
      <Text dimColor> ({elapsed}s)</Text>
    </Box>
  )
}
