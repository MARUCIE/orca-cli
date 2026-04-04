/**
 * Forge CLI built-in tools for function calling.
 *
 * These tools are passed to the OpenAI-compatible chat completions API
 * as function definitions, enabling the model to autonomously read files,
 * list directories, and execute commands — turning chat into an agent.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

// ── Tool Definitions (OpenAI function calling format) ───────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Use this to examine source code, configuration files, documentation, etc.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative file path to read',
          },
          start_line: {
            type: 'number',
            description: 'Optional: start reading from this line number (1-based)',
          },
          end_line: {
            type: 'number',
            description: 'Optional: stop reading at this line number (inclusive)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List files and directories at a given path. Use this to explore project structure.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (absolute or relative)',
          },
          recursive: {
            type: 'boolean',
            description: 'If true, list recursively up to 3 levels deep',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Execute a shell command and return its output. Use for git status, npm test, file searches, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Optional: working directory for the command',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: 'Search for a pattern in files using grep. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Search pattern (regex supported)',
          },
          path: {
            type: 'string',
            description: 'Directory or file to search in',
          },
          file_glob: {
            type: 'string',
            description: 'Optional: file pattern filter (e.g., "*.ts", "*.py")',
          },
        },
        required: ['pattern', 'path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path to write to',
          },
          content: {
            type: 'string',
            description: 'Content to write',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing an exact string with a new string. More precise than write_file — use this for targeted changes.',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_string: { type: 'string', description: 'Exact string to find and replace (must match uniquely)' },
        new_string: { type: 'string', description: 'Replacement string' },
      }, required: ['path', 'old_string', 'new_string'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'glob_files',
      description: 'Find files matching a glob pattern. Use this to discover project structure and find files by name.',
      parameters: { type: 'object', properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.py", "*.json")' },
        path: { type: 'string', description: 'Base directory to search from (default: working directory)' },
      }, required: ['pattern'] },
    },
  },
]

// ── Tool Execution ──────────────────────────────────────────────

export interface ToolResult {
  success: boolean
  output: string
}

export const DANGEROUS_TOOLS = new Set(['write_file', 'edit_file', 'run_command'])

export function executeTool(name: string, args: Record<string, unknown>, cwd: string): ToolResult {
  try {
    switch (name) {
      case 'read_file': return executeReadFile(args, cwd)
      case 'list_directory': return executeListDirectory(args, cwd)
      case 'run_command': return executeRunCommand(args, cwd)
      case 'search_files': return executeSearchFiles(args, cwd)
      case 'write_file': return executeWriteFile(args, cwd)
      case 'edit_file': return executeEditFile(args, cwd)
      case 'glob_files': return executeGlobFiles(args, cwd)
      default: return { success: false, output: `Unknown tool: ${name}` }
    }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

function executeReadFile(args: Record<string, unknown>, cwd: string): ToolResult {
  const filePath = resolve(cwd, String(args.path || ''))
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${filePath}` }
  }
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  const startLine = typeof args.start_line === 'number' ? args.start_line - 1 : 0
  const endLine = typeof args.end_line === 'number' ? args.end_line : lines.length

  const selected = lines.slice(startLine, endLine)

  // Truncate very large files
  if (selected.length > 300) {
    return {
      success: true,
      output: selected.slice(0, 300).join('\n') + `\n\n... (truncated, ${lines.length} total lines)`,
    }
  }
  return { success: true, output: selected.join('\n') }
}

function executeListDirectory(args: Record<string, unknown>, cwd: string): ToolResult {
  const dirPath = resolve(cwd, String(args.path || '.'))
  if (!existsSync(dirPath)) {
    return { success: false, output: `Directory not found: ${dirPath}` }
  }

  const recursive = Boolean(args.recursive)
  const entries: string[] = []

  function listDir(dir: string, prefix: string, depth: number): void {
    if (depth > 3) return
    try {
      const items = readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.') && item !== '.armature.json') continue
        const fullPath = join(dir, item)
        try {
          const stat = statSync(fullPath)
          const marker = stat.isDirectory() ? '/' : ''
          entries.push(`${prefix}${item}${marker}`)
          if (recursive && stat.isDirectory() && entries.length < 200) {
            listDir(fullPath, prefix + '  ', depth + 1)
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* skip inaccessible */ }
  }

  listDir(dirPath, '', 0)

  if (entries.length >= 200) {
    return { success: true, output: entries.join('\n') + '\n... (truncated at 200 entries)' }
  }
  return { success: true, output: entries.join('\n') || '(empty directory)' }
}

function executeRunCommand(args: Record<string, unknown>, cwd: string): ToolResult {
  const command = String(args.command || '')
  if (!command) return { success: false, output: 'No command provided' }

  const execCwd = args.cwd ? resolve(cwd, String(args.cwd)) : cwd

  try {
    const output = execSync(command, {
      cwd: execCwd,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { success: true, output: output.slice(0, 10_000) }
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message: string }
    const output = (execErr.stdout || '') + (execErr.stderr || '') || execErr.message
    return { success: false, output: output.slice(0, 5_000) }
  }
}

function executeSearchFiles(args: Record<string, unknown>, cwd: string): ToolResult {
  const pattern = String(args.pattern || '')
  const searchPath = resolve(cwd, String(args.path || '.'))
  const fileGlob = args.file_glob ? `--include='${args.file_glob}'` : ''

  const cmd = `grep -rn ${fileGlob} '${pattern}' '${searchPath}' 2>/dev/null | head -50`
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 })
    return { success: true, output: output || 'No matches found.' }
  } catch {
    return { success: true, output: 'No matches found.' }
  }
}

function executeWriteFile(args: Record<string, unknown>, cwd: string): ToolResult {
  const filePath = resolve(cwd, String(args.path || ''))
  const content = String(args.content || '')

  try {
    // Read existing content for diff (if file exists)
    let oldContent: string | null = null
    if (existsSync(filePath)) {
      try { oldContent = readFileSync(filePath, 'utf-8') } catch { /* ignore */ }
    }

    const dir = resolve(filePath, '..')
    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, content, 'utf-8')

    // Generate diff summary
    if (oldContent !== null) {
      const oldLines = oldContent.split('\n')
      const newLines = content.split('\n')
      const added = newLines.length - oldLines.length
      const sign = added >= 0 ? `+${added}` : `${added}`
      return {
        success: true,
        output: `Updated ${filePath} (${content.length} bytes, ${newLines.length} lines, ${sign} lines)`,
      }
    }

    return { success: true, output: `Created ${filePath} (${content.length} bytes, ${content.split('\n').length} lines)` }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

function executeEditFile(args: Record<string, unknown>, cwd: string): ToolResult {
  const filePath = resolve(cwd, String(args.path || ''))
  const oldString = String(args.old_string || '')
  const newString = String(args.new_string || '')

  if (!oldString) {
    return { success: false, output: 'old_string is required and must not be empty.' }
  }
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${filePath}` }
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const idx = content.indexOf(oldString)
    if (idx === -1) {
      return { success: false, output: `old_string not found in ${filePath}. Read the file first to get the exact text.` }
    }
    if (content.indexOf(oldString, idx + 1) !== -1) {
      return { success: false, output: `old_string matches multiple locations in ${filePath}. Provide more surrounding context to make it unique.` }
    }

    const newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length)
    writeFileSync(filePath, newContent, 'utf-8')

    const oldLines = oldString.split('\n').length
    const newLines = newString.split('\n').length
    const delta = newLines - oldLines
    const sign = delta >= 0 ? `+${delta}` : `${delta}`
    return { success: true, output: `Edited ${filePath} (replaced ${oldLines} lines with ${newLines} lines, ${sign})` }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

function executeGlobFiles(args: Record<string, unknown>, cwd: string): ToolResult {
  const pattern = String(args.pattern || '')
  const basePath = args.path ? resolve(cwd, String(args.path)) : cwd

  if (!pattern) return { success: false, output: 'pattern is required.' }

  try {
    const escaped = pattern.replace(/'/g, "'\\''")
    let cmd: string
    if (pattern.includes('/') || pattern.includes('**')) {
      const regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.')
      cmd = `cd '${basePath}' && git ls-files --cached --others --exclude-standard 2>/dev/null | grep -E '${regex}' | head -100`
    } else {
      cmd = `cd '${basePath}' && find . -type f -name '${escaped}' 2>/dev/null | sed 's|^\\./||' | head -100`
    }

    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 })
    const files = output.trim().split('\n').filter(Boolean)
    return files.length === 0
      ? { success: true, output: 'No files matched.' }
      : { success: true, output: files.join('\n') }
  } catch {
    return { success: true, output: 'No files matched.' }
  }
}
