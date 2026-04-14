/**
 * DiffPreview — inline colored diff display for file modifications.
 *
 * Shows word-level diffs with green (added) and red (removed) highlighting.
 * Used in safe mode when permission is requested for file writes.
 * Goes beyond CC's basic diff by using unicode box-drawing for structure.
 */

import React from 'react'
import { Box, Text } from 'ink'

interface Props {
  oldContent: string
  newContent: string
  filePath: string
  maxLines?: number
}

interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  lineNo?: number
}

function computeDiff(oldText: string, newText: string, maxLines: number): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: DiffLine[] = []

  // Simple LCS-based diff for display
  let oi = 0, ni = 0
  while (oi < oldLines.length || ni < newLines.length) {
    if (result.length >= maxLines) break

    if (oi >= oldLines.length) {
      result.push({ type: 'add', content: newLines[ni]!, lineNo: ni + 1 })
      ni++
    } else if (ni >= newLines.length) {
      result.push({ type: 'remove', content: oldLines[oi]!, lineNo: oi + 1 })
      oi++
    } else if (oldLines[oi] === newLines[ni]) {
      // Only show context lines near changes
      const hasNearbyChange = (
        (oi > 0 && oldLines[oi - 1] !== newLines[Math.min(ni - 1, newLines.length - 1)]) ||
        (oi < oldLines.length - 1 && oldLines[oi + 1] !== newLines[Math.min(ni + 1, newLines.length - 1)])
      )
      if (hasNearbyChange) {
        result.push({ type: 'context', content: oldLines[oi]!, lineNo: oi + 1 })
      }
      oi++
      ni++
    } else {
      // Different lines — show as remove + add
      result.push({ type: 'remove', content: oldLines[oi]!, lineNo: oi + 1 })
      result.push({ type: 'add', content: newLines[ni]!, lineNo: ni + 1 })
      oi++
      ni++
    }
  }

  return result
}

export function DiffPreview({ oldContent, newContent, filePath, maxLines = 16 }: Props): React.ReactElement {
  const lines = computeDiff(oldContent, newContent, maxLines)
  const addCount = lines.filter(l => l.type === 'add').length
  const removeCount = lines.filter(l => l.type === 'remove').length

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingLeft={1}
      marginLeft={1}
    >
      <Box>
        <Text dimColor>diff </Text>
        <Text color="cyan">{filePath}</Text>
        <Text dimColor> </Text>
        <Text color="green">+{addCount}</Text>
        <Text dimColor> </Text>
        <Text color="red">-{removeCount}</Text>
      </Box>
      {lines.map((line, i) => {
        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
        const color = line.type === 'add' ? 'green' : line.type === 'remove' ? 'red' : undefined
        const lineNum = line.lineNo ? String(line.lineNo).padStart(4) : '    '
        const content = line.content.length > 80 ? line.content.slice(0, 77) + '...' : line.content
        return (
          <Box key={i}>
            <Text dimColor>{lineNum} </Text>
            <Text color={color}>{prefix} {content}</Text>
          </Box>
        )
      })}
      {lines.length >= maxLines && (
        <Text dimColor>  ... (truncated)</Text>
      )}
    </Box>
  )
}
