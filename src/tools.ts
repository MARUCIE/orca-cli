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
  // ── File Management ─────────────────────────────────
  { type: 'function' as const, function: { name: 'delete_file', description: 'Delete a file or empty directory.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to delete' } }, required: ['path'] } } },
  { type: 'function' as const, function: { name: 'move_file', description: 'Move or rename a file/directory.', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path' }, destination: { type: 'string', description: 'Destination path' } }, required: ['source', 'destination'] } } },
  { type: 'function' as const, function: { name: 'copy_file', description: 'Copy a file.', parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source file path' }, destination: { type: 'string', description: 'Destination file path' } }, required: ['source', 'destination'] } } },
  { type: 'function' as const, function: { name: 'create_directory', description: 'Create a directory (with parent directories).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path to create' } }, required: ['path'] } } },
  { type: 'function' as const, function: { name: 'file_info', description: 'Get file metadata: size, modification time, permissions, type.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File or directory path' } }, required: ['path'] } } },
  // ── Search & Analysis ───────────────────────────────
  { type: 'function' as const, function: { name: 'find_definition', description: 'Find where a function, class, type, or variable is defined in the codebase.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Symbol name to find (function, class, type, variable)' }, path: { type: 'string', description: 'Directory to search in (default: working directory)' }, language: { type: 'string', description: 'Optional: language hint (ts, py, go, rust, etc.)' } }, required: ['name'] } } },
  { type: 'function' as const, function: { name: 'find_references', description: 'Find all references/usages of a symbol in the codebase.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Symbol name to search for' }, path: { type: 'string', description: 'Directory to search in' } }, required: ['name'] } } },
  { type: 'function' as const, function: { name: 'directory_tree', description: 'Show a tree view of directory structure with file sizes.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Root directory (default: cwd)' }, depth: { type: 'number', description: 'Max depth (default: 3)' }, show_size: { type: 'boolean', description: 'Show file sizes (default: true)' } }, required: [] } } },
  { type: 'function' as const, function: { name: 'count_lines', description: 'Count lines of code in files, grouped by language.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory or file to analyze' } }, required: [] } } },
  // ── Git ──────────────────────────────────────────────
  { type: 'function' as const, function: { name: 'git_status', description: 'Show git status: staged, modified, and untracked files.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'git_diff', description: 'Show git diff for working tree or specific file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Optional: specific file to diff' }, staged: { type: 'boolean', description: 'Show staged changes (default: false)' } }, required: [] } } },
  { type: 'function' as const, function: { name: 'git_log', description: 'Show recent git commits.', parameters: { type: 'object', properties: { count: { type: 'number', description: 'Number of commits (default: 10)' }, path: { type: 'string', description: 'Optional: filter by file path' } }, required: [] } } },
  { type: 'function' as const, function: { name: 'git_commit', description: 'Stage files and create a git commit.', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Commit message' }, files: { type: 'array', items: { type: 'string' }, description: 'Files to stage (default: all modified)' } }, required: ['message'] } } },
  // ── Web ──────────────────────────────────────────────
  { type: 'function' as const, function: { name: 'fetch_url', description: 'Fetch content from a URL (HTTP GET). Returns text or HTML.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch' }, format: { type: 'string', description: 'Response format: text (default), json, headers' } }, required: ['url'] } } },
  // ── Code Generation ─────────────────────────────────
  { type: 'function' as const, function: { name: 'multi_edit', description: 'Apply multiple edits to the same file in one operation. Each edit is an old_string→new_string replacement.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File to edit' }, edits: { type: 'array', items: { type: 'object', properties: { old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['old_string', 'new_string'] }, description: 'Array of {old_string, new_string} pairs' } }, required: ['path', 'edits'] } } },
  { type: 'function' as const, function: { name: 'patch_file', description: 'Apply a unified diff patch to a file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File to patch' }, patch: { type: 'string', description: 'Unified diff content' } }, required: ['path', 'patch'] } } },
  // ── Process ─────────────────────────────────────────
  { type: 'function' as const, function: { name: 'run_background', description: 'Start a long-running command in the background. Returns a process ID.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command to run' }, cwd: { type: 'string', description: 'Working directory' } }, required: ['command'] } } },
  { type: 'function' as const, function: { name: 'check_port', description: 'Check if a network port is in use and what process is using it.', parameters: { type: 'object', properties: { port: { type: 'number', description: 'Port number to check' } }, required: ['port'] } } },
]

// ── Tool Execution ──────────────────────────────────────────────

export interface ToolResult {
  success: boolean
  output: string
}

export const DANGEROUS_TOOLS = new Set([
  'write_file', 'edit_file', 'multi_edit', 'patch_file',
  'delete_file', 'move_file', 'run_command', 'run_background', 'git_commit',
])

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
      case 'delete_file': return execShellTool(`rm '${resolve(cwd, String(args.path || ''))}'`, cwd)
      case 'move_file': return execShellTool(`mv '${resolve(cwd, String(args.source || ''))}' '${resolve(cwd, String(args.destination || ''))}'`, cwd)
      case 'copy_file': return execShellTool(`cp '${resolve(cwd, String(args.source || ''))}' '${resolve(cwd, String(args.destination || ''))}'`, cwd)
      case 'create_directory': return execShellTool(`mkdir -p '${resolve(cwd, String(args.path || ''))}'`, cwd)
      case 'file_info': return executeFileInfo(args, cwd)
      case 'find_definition': return executeFindDefinition(args, cwd)
      case 'find_references': return execShellTool(`grep -rn '\\b${String(args.name || '')}\\b' '${resolve(cwd, String(args.path || '.'))}' --include='*.{ts,js,py,go,rs,java,c,cpp,h,rb,swift,kt}' 2>/dev/null | head -30`, cwd)
      case 'directory_tree': return execShellTool(`find '${resolve(cwd, String(args.path || '.'))}' -maxdepth ${Number(args.depth) || 3} -not -path '*/\\.*' -not -path '*/node_modules/*' 2>/dev/null | head -200 | sort`, cwd)
      case 'count_lines': return execShellTool(`find '${resolve(cwd, String(args.path || '.'))}' -type f -not -path '*/\\.*' -not -path '*/node_modules/*' -not -path '*/dist/*' | xargs wc -l 2>/dev/null | sort -rn | head -30`, cwd)
      case 'git_status': return execShellTool('git status --short', cwd)
      case 'git_diff': return execShellTool(`git diff ${args.staged ? '--staged' : ''} ${args.path ? `'${args.path}'` : ''} 2>/dev/null`, cwd)
      case 'git_log': return execShellTool(`git log --oneline -${Number(args.count) || 10} ${args.path ? `-- '${args.path}'` : ''}`, cwd)
      case 'git_commit': return executeGitCommit(args, cwd)
      case 'fetch_url': return executeFetchUrl(args)
      case 'multi_edit': return executeMultiEdit(args, cwd)
      case 'patch_file': return execShellTool(`echo '${String(args.patch || '').replace(/'/g, "'\\''")}' | patch '${resolve(cwd, String(args.path || ''))}'`, cwd)
      case 'run_background': return execShellTool(`nohup ${String(args.command || '')} > /dev/null 2>&1 & echo "PID: $!"`, args.cwd ? resolve(cwd, String(args.cwd)) : cwd)
      case 'check_port': return execShellTool(`lsof -i :${Number(args.port) || 0} 2>/dev/null || echo "Port ${args.port} is free"`, cwd)
      default: return { success: false, output: `Unknown tool: ${name}` }
    }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

/** Shell helper for simple tools */
function execShellTool(cmd: string, cwd: string): ToolResult {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
    return { success: true, output: output.slice(0, 10_000) || '(empty output)' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return { success: false, output: ((e.stdout || '') + (e.stderr || '') || e.message).slice(0, 5_000) }
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

function executeFileInfo(args: Record<string, unknown>, cwd: string): ToolResult {
  const filePath = resolve(cwd, String(args.path || ''))
  if (!existsSync(filePath)) return { success: false, output: `Not found: ${filePath}` }
  try {
    const stat = statSync(filePath)
    const info = [
      `path: ${filePath}`,
      `type: ${stat.isDirectory() ? 'directory' : 'file'}`,
      `size: ${stat.size} bytes`,
      `modified: ${stat.mtime.toISOString()}`,
      `created: ${stat.birthtime.toISOString()}`,
      `mode: ${stat.mode.toString(8)}`,
    ]
    if (!stat.isDirectory()) {
      const lines = readFileSync(filePath, 'utf-8').split('\n').length
      info.push(`lines: ${lines}`)
    }
    return { success: true, output: info.join('\n') }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

function executeFindDefinition(args: Record<string, unknown>, cwd: string): ToolResult {
  const name = String(args.name || '')
  const searchPath = resolve(cwd, String(args.path || '.'))
  if (!name) return { success: false, output: 'name is required.' }

  // Language-aware definition patterns
  const patterns = [
    `function\\s+${name}`,           // JS/TS/Go
    `const\\s+${name}\\s*=`,         // JS/TS const
    `let\\s+${name}\\s*=`,           // JS/TS let
    `class\\s+${name}`,              // JS/TS/Python/Java
    `interface\\s+${name}`,          // TS
    `type\\s+${name}`,               // TS/Go
    `def\\s+${name}`,                // Python
    `fn\\s+${name}`,                 // Rust
    `func\\s+${name}`,               // Go
    `export\\s+(default\\s+)?.*${name}`, // ES module exports
  ]

  const combined = patterns.join('|')
  try {
    const cmd = `grep -rn -E '${combined}' '${searchPath}' --include='*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h,rb,swift,kt,mjs,cjs}' 2>/dev/null | head -20`
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 })
    return { success: true, output: output || `No definition found for "${name}"` }
  } catch {
    return { success: true, output: `No definition found for "${name}"` }
  }
}

function executeGitCommit(args: Record<string, unknown>, cwd: string): ToolResult {
  const message = String(args.message || '')
  if (!message) return { success: false, output: 'message is required.' }

  try {
    const files = args.files as string[] | undefined
    if (files && files.length > 0) {
      execSync(`git add ${files.map(f => `'${f}'`).join(' ')}`, { cwd, encoding: 'utf-8', timeout: 10_000 })
    } else {
      execSync('git add -A', { cwd, encoding: 'utf-8', timeout: 10_000 })
    }
    const output = execSync(`git commit -m '${message.replace(/'/g, "'\\''")}'`, { cwd, encoding: 'utf-8', timeout: 10_000 })
    return { success: true, output }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return { success: false, output: ((e.stdout || '') + (e.stderr || '') || e.message).slice(0, 3_000) }
  }
}

function executeFetchUrl(args: Record<string, unknown>): ToolResult {
  const url = String(args.url || '')
  if (!url) return { success: false, output: 'url is required.' }

  try {
    const format = String(args.format || 'text')
    const cmd = format === 'headers'
      ? `curl -sI '${url}' 2>/dev/null | head -30`
      : `curl -sL '${url}' 2>/dev/null | head -500`
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024 })
    return { success: true, output: output.slice(0, 20_000) }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

function executeMultiEdit(args: Record<string, unknown>, cwd: string): ToolResult {
  const filePath = resolve(cwd, String(args.path || ''))
  const edits = args.edits as Array<{ old_string: string; new_string: string }> | undefined

  if (!edits || !Array.isArray(edits) || edits.length === 0) {
    return { success: false, output: 'edits array is required.' }
  }
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${filePath}` }
  }

  try {
    let content = readFileSync(filePath, 'utf-8')
    let appliedCount = 0

    for (const edit of edits) {
      const oldStr = String(edit.old_string || '')
      const newStr = String(edit.new_string || '')
      if (!oldStr) continue

      const idx = content.indexOf(oldStr)
      if (idx === -1) {
        return { success: false, output: `Edit ${appliedCount + 1}/${edits.length} failed: old_string not found. Applied ${appliedCount} edits before failure.` }
      }
      content = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length)
      appliedCount++
    }

    writeFileSync(filePath, content, 'utf-8')
    return { success: true, output: `Applied ${appliedCount} edits to ${filePath}` }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}
