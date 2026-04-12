/**
 * Interactive slash command picker.
 *
 * Shows a filterable, arrow-key navigable command list when user types `/`.
 * - Real-time filtering as user types
 * - Up/Down arrow navigation with highlight
 * - Enter to select, Esc to cancel
 * - Renders below the prompt using ANSI escape codes
 */

export interface CommandDef {
  name: string
  description: string
}

const COMMANDS: CommandDef[] = [
  { name: '/help', description: 'Show all commands' },
  { name: '/model', description: 'Show/switch model' },
  { name: '/models', description: 'Interactive model picker' },
  { name: '/council', description: 'Multi-model council (N models + judge)' },
  { name: '/race', description: 'Multi-model race (first wins)' },
  { name: '/pipeline', description: 'Multi-model pipeline (plan→code→review)' },
  { name: '/clear', description: 'Clear conversation history' },
  { name: '/compact', description: 'Keep last 2 turns' },
  { name: '/system', description: 'Set system prompt' },
  { name: '/diff', description: 'Show git diff' },
  { name: '/git', description: 'Run git command' },
  { name: '/save', description: 'Save session to disk' },
  { name: '/load', description: 'Load saved session' },
  { name: '/sessions', description: 'List saved sessions' },
  { name: '/jobs', description: 'List tracked background jobs' },
  { name: '/undo', description: 'Revert last file write' },
  { name: '/effort', description: 'Set thinking: low/medium/high/max' },
  { name: '/retry', description: 'Retry last message' },
  { name: '/hooks', description: 'Show registered hooks' },
  { name: '/history', description: 'Show message counts' },
  { name: '/tokens', description: 'Token breakdown' },
  { name: '/stats', description: 'Session statistics' },
  { name: '/cwd', description: 'Working directory' },
  { name: '/exit', description: 'Exit with summary' },
]

/**
 * Run the interactive command picker.
 * Returns the selected command string, or null if cancelled.
 */
export function runCommandPicker(filter = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(null)
      return
    }

    let selectedIdx = 0
    let currentFilter = filter
    let menuLines = 0

    const getFiltered = (): CommandDef[] => {
      if (!currentFilter) return COMMANDS
      return COMMANDS.filter(c =>
        c.name.startsWith('/' + currentFilter) ||
        c.description.toLowerCase().includes(currentFilter.toLowerCase())
      )
    }

    const render = () => {
      // Clear previous menu
      if (menuLines > 0) {
        process.stdout.write(`\x1b[${menuLines}A\x1b[J`)
      }

      const filtered = getFiltered()
      if (filtered.length === 0) {
        process.stdout.write('\x1b[90m  (no matching commands)\x1b[0m\n')
        menuLines = 1
        return
      }

      // Clamp selection
      if (selectedIdx >= filtered.length) selectedIdx = filtered.length - 1
      if (selectedIdx < 0) selectedIdx = 0

      // Show at most 10 items
      const maxVisible = Math.min(10, filtered.length)
      let startIdx = 0
      if (selectedIdx >= maxVisible) {
        startIdx = selectedIdx - maxVisible + 1
      }
      const visible = filtered.slice(startIdx, startIdx + maxVisible)

      const lines: string[] = []
      lines.push('\x1b[90m  ╭─ commands ─────────────────────────────────╮\x1b[0m')

      for (let i = 0; i < visible.length; i++) {
        const cmd = visible[i]!
        const globalIdx = startIdx + i
        const isSelected = globalIdx === selectedIdx
        const prefix = isSelected ? '\x1b[36m  │ ▸ ' : '\x1b[90m  │   '
        const name = isSelected
          ? `\x1b[1;36m${cmd.name.padEnd(14)}\x1b[0m`
          : `\x1b[37m${cmd.name.padEnd(14)}\x1b[0m`
        const desc = `\x1b[90m${cmd.description}\x1b[0m`
        lines.push(`${prefix}${name} ${desc}`)
      }

      if (filtered.length > maxVisible) {
        lines.push(`\x1b[90m  │   ... ${filtered.length - maxVisible} more\x1b[0m`)
      }

      lines.push('\x1b[90m  ╰─ ↑↓ select · enter confirm · esc cancel ─╯\x1b[0m')

      const output = lines.join('\n') + '\n'
      process.stdout.write(output)
      menuLines = lines.length
    }

    // Initial render
    render()

    // Enter raw mode for keypress handling
    const wasRaw = process.stdin.isRaw
    process.stdin.setRawMode(true)
    process.stdin.resume()

    const cleanup = () => {
      process.stdin.removeListener('data', onData)
      if (!wasRaw) process.stdin.setRawMode(false)
      // Clear menu
      if (menuLines > 0) {
        process.stdout.write(`\x1b[${menuLines}A\x1b[J`)
      }
    }

    const onData = (data: Buffer) => {
      const filtered = getFiltered()

      // Arrow up
      if (data[0] === 0x1b && data[1] === 0x5b && data[2] === 0x41) {
        selectedIdx = Math.max(0, selectedIdx - 1)
        render()
        return
      }

      // Arrow down
      if (data[0] === 0x1b && data[1] === 0x5b && data[2] === 0x42) {
        selectedIdx = Math.min(filtered.length - 1, selectedIdx + 1)
        render()
        return
      }

      // Enter
      if (data[0] === 0x0d || data[0] === 0x0a) {
        cleanup()
        const selected = filtered[selectedIdx]
        resolve(selected ? selected.name : null)
        return
      }

      // Escape
      if (data[0] === 0x1b && data.length === 1) {
        cleanup()
        resolve(null)
        return
      }

      // Ctrl+C
      if (data[0] === 0x03) {
        cleanup()
        resolve(null)
        return
      }

      // Backspace
      if (data[0] === 0x7f || data[0] === 0x08) {
        if (currentFilter.length > 0) {
          currentFilter = currentFilter.slice(0, -1)
          selectedIdx = 0
          render()
        }
        return
      }

      // Printable character — add to filter
      if (data[0]! >= 0x20 && data[0]! < 0x7f) {
        currentFilter += String.fromCharCode(data[0]!)
        selectedIdx = 0
        render()
        return
      }
    }

    process.stdin.on('data', onData)
  })
}
