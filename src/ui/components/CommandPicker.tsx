/**
 * CommandPicker — filterable, arrow-key navigable slash command list.
 *
 * Replaces the raw ANSI command-picker.ts with an ink component.
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'

export interface CommandDef {
  name: string
  description: string
}

interface Props {
  commands: CommandDef[]
  filter: string
  onSelect: (command: string) => void
  onCancel: () => void
  active: boolean
}

export function CommandPicker({ commands, filter, onSelect, onCancel, active }: Props): React.ReactElement | null {
  const [selectedIdx, setSelectedIdx] = useState(0)

  const filtered = useMemo(() => {
    if (!filter) return commands
    const lower = filter.toLowerCase()
    return commands.filter(c =>
      c.name.toLowerCase().includes(lower) || c.description.toLowerCase().includes(lower),
    )
  }, [commands, filter])

  useInput(
    (_input, key) => {
      if (!active || filtered.length === 0) return

      if (key.upArrow) {
        setSelectedIdx(prev => Math.max(0, prev - 1))
      } else if (key.downArrow) {
        setSelectedIdx(prev => Math.min(filtered.length - 1, prev + 1))
      } else if (key.return) {
        const cmd = filtered[selectedIdx]
        if (cmd) onSelect(cmd.name)
      } else if (key.escape) {
        onCancel()
      }
    },
    { isActive: active },
  )

  if (!active || filtered.length === 0) return null

  const maxVisible = 12
  const start = Math.max(0, selectedIdx - Math.floor(maxVisible / 2))
  const visible = filtered.slice(start, start + maxVisible)

  return (
    <Box flexDirection="column" marginLeft={2}>
      {visible.map((cmd, i) => {
        const idx = start + i
        const isSelected = idx === selectedIdx
        return (
          <Box key={cmd.name}>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {isSelected ? '> ' : '  '}
            </Text>
            <Text color={isSelected ? 'cyan' : 'yellow'}>{cmd.name.padEnd(16)}</Text>
            <Text dimColor>{cmd.description}</Text>
          </Box>
        )
      })}
      {filtered.length > maxVisible && (
        <Text dimColor>  ... {filtered.length - maxVisible} more</Text>
      )}
    </Box>
  )
}
