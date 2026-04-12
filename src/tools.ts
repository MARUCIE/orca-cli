/**
 * Orca CLI built-in tools for function calling.
 *
 * These tools are passed to the OpenAI-compatible chat completions API
 * as function definitions, enabling the model to autonomously read files,
 * list directories, and execute commands — turning chat into an agent.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { startBackgroundJob } from './background-jobs.js'

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
  { type: 'function' as const, function: { name: 'run_background', description: 'Start a long-running command in the background. Returns a tracked job record and can notify the REPL when the job finishes.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command to run' }, cwd: { type: 'string', description: 'Working directory' }, notify_on_complete: { type: 'boolean', description: 'If true (default), surface a completion notification when the job finishes' } }, required: ['command'] } } },
  { type: 'function' as const, function: { name: 'check_port', description: 'Check if a network port is in use and what process is using it.', parameters: { type: 'object', properties: { port: { type: 'number', description: 'Port number to check' } }, required: ['port'] } } },
  // ── Agent & Delegation ─────────────────────────────
  { type: 'function' as const, function: { name: 'spawn_agent', description: 'Spawn a sub-agent to handle a task in parallel. The sub-agent has its own conversation and tool access. Returns the result when done.', parameters: { type: 'object', properties: { task: { type: 'string', description: 'Task description for the sub-agent' }, type: { type: 'string', description: 'Agent type: general (default), explore (fast search), plan (design only)' } }, required: ['task'] } } },
  { type: 'function' as const, function: { name: 'delegate_task', description: 'Delegate a focused task to a specialist sub-agent and wait for the result.', parameters: { type: 'object', properties: { task: { type: 'string', description: 'Task to delegate' }, context: { type: 'string', description: 'Additional context for the sub-agent' } }, required: ['task'] } } },
  // ── Task Management ─────────────────────────────────
  { type: 'function' as const, function: { name: 'task_create', description: 'Create a task to track progress on a multi-step goal.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Task title' }, description: { type: 'string', description: 'Task description' } }, required: ['title'] } } },
  { type: 'function' as const, function: { name: 'task_update', description: 'Update task status.', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Task ID' }, status: { type: 'string', description: 'Status: pending, in_progress, completed, failed' } }, required: ['id', 'status'] } } },
  { type: 'function' as const, function: { name: 'task_list', description: 'List all tasks with their status.', parameters: { type: 'object', properties: {}, required: [] } } },
  // ── User Interaction ────────────────────────────────
  { type: 'function' as const, function: { name: 'ask_user', description: 'Ask the user a question and wait for their response. Use when you need clarification.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'Question to ask' }, options: { type: 'array', items: { type: 'string' }, description: 'Optional: multiple-choice options' } }, required: ['question'] } } },
  { type: 'function' as const, function: { name: 'notify_user', description: 'Send a notification/status update to the user without waiting for a response.', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Message to display' }, level: { type: 'string', description: 'Level: info (default), success, warning, error' } }, required: ['message'] } } },
  // ── Planning ────────────────────────────────────────
  { type: 'function' as const, function: { name: 'create_plan', description: 'Create a structured execution plan before implementing.', parameters: { type: 'object', properties: { goal: { type: 'string', description: 'Goal to plan for' }, steps: { type: 'array', items: { type: 'string' }, description: 'Ordered list of steps' } }, required: ['goal', 'steps'] } } },
  { type: 'function' as const, function: { name: 'verify_plan', description: 'Verify that a plan was executed correctly by checking expected outcomes.', parameters: { type: 'object', properties: { plan_id: { type: 'string', description: 'Plan ID to verify' }, checks: { type: 'array', items: { type: 'string' }, description: 'Verification checks to run' } }, required: ['checks'] } } },
  // ── Web ──────────────────────────────────────────────
  { type: 'function' as const, function: { name: 'web_search', description: 'Search the web and return results. Use when you need current information.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, count: { type: 'number', description: 'Number of results (default: 5)' } }, required: ['query'] } } },
  // ── MCP ──────────────────────────────────────────────
  { type: 'function' as const, function: { name: 'mcp_list_servers', description: 'List connected MCP (Model Context Protocol) servers and their available tools.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'mcp_list_resources', description: 'List resources available from MCP servers.', parameters: { type: 'object', properties: { server: { type: 'string', description: 'MCP server name (optional, lists all if omitted)' } }, required: [] } } },
  { type: 'function' as const, function: { name: 'mcp_read_resource', description: 'Read a resource from an MCP server by URI.', parameters: { type: 'object', properties: { uri: { type: 'string', description: 'Resource URI (e.g., file:///path or custom://resource)' } }, required: ['uri'] } } },
  // ── Scheduling ──────────────────────────────────────
  { type: 'function' as const, function: { name: 'sleep', description: 'Wait for a specified duration before continuing.', parameters: { type: 'object', properties: { seconds: { type: 'number', description: 'Seconds to wait' }, reason: { type: 'string', description: 'Why waiting (e.g., "waiting for server to start")' } }, required: ['seconds'] } } },
  // ── Notebook ────────────────────────────────────────
  { type: 'function' as const, function: { name: 'notebook_edit', description: 'Edit a Jupyter notebook cell.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Notebook file path (.ipynb)' }, cell_index: { type: 'number', description: 'Cell index (0-based)' }, content: { type: 'string', description: 'New cell content' }, cell_type: { type: 'string', description: 'Cell type: code (default), markdown' } }, required: ['path', 'cell_index', 'content'] } } },
  // ── Tool Discovery ──────────────────────────────────
  { type: 'function' as const, function: { name: 'tool_search', description: 'Search available tools by keyword. Useful when you are not sure which tool to use.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Keyword to search for in tool names and descriptions' } }, required: ['query'] } } },
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

const TOOL_SCHEMA_BY_NAME = new Map(
  TOOL_DEFINITIONS.map((tool) => [tool.function.name, tool.function.parameters] as const),
)

export function executeTool(name: string, args: Record<string, unknown>, cwd: string): ToolResult {
  try {
    const normalizedArgs = normalizeToolArgs(name, args)
    switch (name) {
      case 'read_file': return executeReadFile(normalizedArgs, cwd)
      case 'list_directory': return executeListDirectory(normalizedArgs, cwd)
      case 'run_command': return executeRunCommand(normalizedArgs, cwd)
      case 'search_files': return executeSearchFiles(normalizedArgs, cwd)
      case 'write_file': return executeWriteFile(normalizedArgs, cwd)
      case 'edit_file': return executeEditFile(normalizedArgs, cwd)
      case 'glob_files': return executeGlobFiles(normalizedArgs, cwd)
      case 'delete_file': return execShellTool(`rm '${resolve(cwd, String(normalizedArgs.path || ''))}'`, cwd)
      case 'move_file': return execShellTool(`mv '${resolve(cwd, String(normalizedArgs.source || ''))}' '${resolve(cwd, String(normalizedArgs.destination || ''))}'`, cwd)
      case 'copy_file': return execShellTool(`cp '${resolve(cwd, String(normalizedArgs.source || ''))}' '${resolve(cwd, String(normalizedArgs.destination || ''))}'`, cwd)
      case 'create_directory': return execShellTool(`mkdir -p '${resolve(cwd, String(normalizedArgs.path || ''))}'`, cwd)
      case 'file_info': return executeFileInfo(normalizedArgs, cwd)
      case 'find_definition': return executeFindDefinition(normalizedArgs, cwd)
      case 'find_references': {
        const refName = shellEscape(String(normalizedArgs.name || ''))
        const refPath = shellEscape(resolve(cwd, String(normalizedArgs.path || '.')))
        const refIncludes = ['ts','js','py','go','rs','java','c','cpp','h','rb'].map(e => `--include='*.${e}'`).join(' ')
        return execShellTool(`grep -rn '\\b${refName}\\b' '${refPath}' ${refIncludes} 2>/dev/null | head -30`, cwd)
      }
      case 'directory_tree': return execShellTool(`find '${shellEscape(resolve(cwd, String(normalizedArgs.path || '.')))}' -maxdepth ${Number(normalizedArgs.depth) || 3} -not -path '*/\\.*' -not -path '*/node_modules/*' 2>/dev/null | head -200 | sort`, cwd)
      case 'count_lines': return execShellTool(`find '${shellEscape(resolve(cwd, String(normalizedArgs.path || '.')))}' -type f -not -path '*/\\.*' -not -path '*/node_modules/*' -not -path '*/dist/*' | xargs wc -l 2>/dev/null | sort -rn | head -30`, cwd)
      case 'git_status': return execShellTool('git status --short', cwd)
      case 'git_diff': return execShellTool(`git diff ${normalizedArgs.staged ? '--staged' : ''} ${normalizedArgs.path ? `'${shellEscape(String(normalizedArgs.path))}'` : ''} 2>/dev/null`, cwd)
      case 'git_log': return execShellTool(`git log --oneline -${Number(normalizedArgs.count) || 10} ${normalizedArgs.path ? `-- '${shellEscape(String(normalizedArgs.path))}'` : ''}`, cwd)
      case 'git_commit': return executeGitCommit(normalizedArgs, cwd)
      case 'fetch_url': return executeFetchUrl(normalizedArgs)
      case 'multi_edit': return executeMultiEdit(normalizedArgs, cwd)
      case 'patch_file': return execShellTool(`echo '${String(normalizedArgs.patch || '').replace(/'/g, "'\\''")}' | patch '${resolve(cwd, String(normalizedArgs.path || ''))}'`, cwd)
      case 'run_background': return executeRunBackground(normalizedArgs, cwd)
      case 'check_port': return execShellTool(`lsof -i :${Number(normalizedArgs.port) || 0} 2>/dev/null || echo "Port ${normalizedArgs.port} is free"`, cwd)
      // Agent & delegation (handled at caller level for async — return stub here)
      case 'spawn_agent': return { success: true, output: '[spawn_agent requires async handling — see chat.ts onToolCall]' }
      case 'delegate_task': return { success: true, output: '[delegate_task requires async handling — see chat.ts onToolCall]' }
      // Task management
      case 'task_create': return executeTaskCreate(normalizedArgs, cwd)
      case 'task_update': return executeTaskUpdate(normalizedArgs, cwd)
      case 'task_list': return executeTaskList(cwd)
      // User interaction (handled at caller level)
      case 'ask_user': return { success: true, output: `[ask_user: ${String(normalizedArgs.question || '')}]` }
      case 'notify_user': return executeNotifyUser(normalizedArgs)
      // Planning
      case 'create_plan': return executeCreatePlan(normalizedArgs, cwd)
      case 'verify_plan': return executeVerifyPlan(normalizedArgs, cwd)
      // Web
      case 'web_search': return executeWebSearch(normalizedArgs)
      // MCP (async — handled in chat.ts onToolCall for live connections)
      case 'mcp_list_servers': return executeMcpListServers(cwd)
      case 'mcp_list_resources': return { success: true, output: '[mcp_list_resources: async — handled in chat.ts]' }
      case 'mcp_read_resource': return { success: true, output: '[mcp_read_resource: async — handled in chat.ts]' }
      // Scheduling
      case 'sleep': return { success: true, output: `Waiting ${Number(normalizedArgs.seconds) || 1}s... ${String(normalizedArgs.reason || '')}` }
      // Notebook
      case 'notebook_edit': return executeNotebookEdit(normalizedArgs, cwd)
      // Tool discovery
      case 'tool_search': return executeToolSearch(normalizedArgs)
      default: return { success: false, output: `Unknown tool: ${name}` }
    }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

/** Escape a string for safe use inside single-quoted shell arguments. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''")
}

function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const schema = TOOL_SCHEMA_BY_NAME.get(name)
  if (!schema || typeof schema !== 'object') return args

  const properties = (schema as unknown as { properties?: Record<string, Record<string, unknown> | undefined> }).properties
  if (!properties) return args

  const normalized: Record<string, unknown> = { ...args }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!propertySchema) continue
    normalized[key] = coerceValue(normalized[key], propertySchema)
  }
  return normalized
}

function coerceValue(value: unknown, schema: Record<string, unknown>): unknown {
  if (value === undefined || value === null) return value

  const type = schema.type
  if (type === 'number') {
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value)
    }
    return value
  }

  if (type === 'boolean') {
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase()
      if (lower === 'true') return true
      if (lower === 'false') return false
    }
    return value
  }

  if (type === 'array') {
    const itemSchema = (schema.items || {}) as Record<string, unknown>
    if (Array.isArray(value)) {
      return value.map((item) => coerceValue(item, itemSchema))
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) {
            return parsed.map((item) => coerceValue(item, itemSchema))
          }
        } catch { /* fall through */ }
      }
      if (itemSchema.type === 'string') {
        return trimmed
          .split(/\s*,\s*|\n+/)
          .map((item) => item.trim())
          .filter(Boolean)
      }
    }
    return value
  }

  if (type === 'object' && typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') return parsed
    } catch { /* ignore invalid JSON */ }
  }

  return value
}

function getToolResultsDir(): string {
  const orcaHome = process.env.ORCA_HOME || join(process.env.HOME || homedir(), '.orca')
  const dir = join(orcaHome, 'tool-results')
  mkdirSync(dir, { recursive: true })
  return dir
}

function persistOversizedToolOutput(label: string, output: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tool-output'
  const hash = createHash('sha1').update(output).digest('hex').slice(0, 8)
  const filePath = join(getToolResultsDir(), `${timestamp}-${safeLabel}-${hash}.txt`)
  writeFileSync(filePath, output, 'utf-8')
  return filePath
}

function formatPersistedOutput(fullOutput: string, preview: string, summary: string, label: string): string {
  const artifactPath = persistOversizedToolOutput(label, fullOutput)
  return `${summary}\nSaved full output to ${artifactPath}\n${preview}\n... (truncated, ${fullOutput.split('\n').length} total lines)`
}

/**
 * Smartly truncate tool output: if output exceeds limit, add a summary
 * header with line count and file mentions before truncating.
 * Prevents context pollution from large grep/list results.
 */
function smartTruncate(output: string, limit = 8_000): string {
  if (output.length <= limit) return output
  const lines = output.split('\n')
  const totalLines = lines.length
  // Extract unique file paths mentioned in output (grep-style: "file:line: content")
  const fileSet = new Set<string>()
  for (const line of lines.slice(0, 100)) {
    const match = line.match(/^([^:]+\.[a-zA-Z]+):\d+/)
    if (match) fileSet.add(match[1]!)
  }
  const summary = `[${totalLines} lines total, ${fileSet.size > 0 ? `${fileSet.size} files: ${[...fileSet].slice(0, 5).join(', ')}${fileSet.size > 5 ? '...' : ''}` : 'truncated'}]`
  const preview = output.slice(0, Math.max(0, limit - 400))
  return formatPersistedOutput(output, preview, summary, 'tool-output')
}

/** Shell helper for simple tools */
function execShellTool(cmd: string, cwd: string): ToolResult {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
    return { success: true, output: smartTruncate(output) || '(empty output)' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return { success: false, output: ((e.stdout || '') + (e.stderr || '') || e.message).slice(0, 5_000) }
  }
}

function executeReadFile(args: Record<string, unknown>, cwd: string): ToolResult {
  const filePath = resolve(cwd, String(args.path || ''))
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${filePath}. Use list_directory or glob_files to discover available files.` }
  }
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  const startLine = typeof args.start_line === 'number' ? Math.max(0, args.start_line - 1) : 0
  const endLine = typeof args.end_line === 'number' ? args.end_line : lines.length

  const selected = lines.slice(startLine, endLine)

  // Truncate very large files
  if (selected.length > 300) {
    return {
      success: true,
      output: formatPersistedOutput(
        selected.join('\n'),
        selected.slice(0, 300).join('\n'),
        `[${selected.length} lines requested from ${basename(filePath)}]`,
        basename(filePath),
      ),
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
        if (item.startsWith('.') && item !== '.orca.json') continue
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
    return {
      success: true,
      output: formatPersistedOutput(
        entries.join('\n'),
        entries.slice(0, 200).join('\n'),
        `[${entries.length} directory entries total]`,
        `list-${basename(dirPath) || 'root'}`,
      ),
    }
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
    return { success: true, output: smartTruncate(output, 10_000) }
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message: string }
    const output = (execErr.stdout || '') + (execErr.stderr || '') || execErr.message
    return { success: false, output: output.slice(0, 5_000) }
  }
}

function executeRunBackground(args: Record<string, unknown>, cwd: string): ToolResult {
  const command = String(args.command || '')
  if (!command) return { success: false, output: 'command is required.' }

  const execCwd = args.cwd ? resolve(cwd, String(args.cwd)) : cwd
  const notifyOnComplete = args.notify_on_complete !== false

  try {
    const job = startBackgroundJob(command, execCwd, notifyOnComplete)
    return {
      success: true,
      output: [
        `Started background job ${job.id}`,
        `cwd: ${job.cwd}`,
        `log: ${job.logPath}`,
        `notify_on_complete: ${job.notifyOnComplete ? 'true' : 'false'}`,
      ].join('\n'),
    }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

function executeSearchFiles(args: Record<string, unknown>, cwd: string): ToolResult {
  const pattern = String(args.pattern || '')
  const searchPath = resolve(cwd, String(args.path || '.'))
  const fileGlob = args.file_glob ? `--include='${shellEscape(String(args.file_glob))}'` : ''

  const cmd = `grep -rn ${fileGlob} '${shellEscape(pattern)}' '${shellEscape(searchPath)}' 2>/dev/null | head -50`
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 })
    return { success: true, output: smartTruncate(output) || 'No matches found.' }
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
      return { success: false, output: `old_string not found in ${filePath}. Use read_file to get the exact current text, then retry with the precise string. Whitespace and newlines must match exactly.` }
    }
    if (content.indexOf(oldString, idx + 1) !== -1) {
      return { success: false, output: `old_string matches multiple locations in ${filePath}. Include more surrounding lines (before and after) to make the match unique.` }
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
      cmd = `cd '${shellEscape(basePath)}' && git ls-files --cached --others --exclude-standard 2>/dev/null | grep -E '${shellEscape(regex)}' | head -100`
    } else {
      cmd = `cd '${shellEscape(basePath)}' && find . -type f -name '${escaped}' 2>/dev/null | sed 's|^\\./||' | head -100`
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
  if (!name) return { success: false, output: 'name is required. Provide a function, class, or variable name to search for.' }

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
  const includes = ['ts','tsx','js','jsx','py','go','rs','java','c','cpp','h','rb','swift','kt'].map(e => `--include='*.${e}'`).join(' ')
  try {
    const cmd = `grep -rn -E '${shellEscape(combined)}' '${shellEscape(searchPath)}' ${includes} 2>/dev/null | head -20`
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 })
    return { success: true, output: output || `No definition found for "${name}"` }
  } catch {
    return { success: true, output: `No definition found for "${name}"` }
  }
}

function executeGitCommit(args: Record<string, unknown>, cwd: string): ToolResult {
  const message = String(args.message || '')
  if (!message) return { success: false, output: 'message is required. Provide a descriptive commit message.' }

  try {
    const files = args.files as string[] | undefined
    if (files && files.length > 0) {
      execSync(`git add ${files.map(f => `'${f}'`).join(' ')}`, {
        cwd,
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } else {
      execSync('git add -A', {
        cwd,
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    }
    const output = execSync(`git commit -m '${message.replace(/'/g, "'\\''")}'`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
    const safeUrl = shellEscape(url)
    const cmd = format === 'headers'
      ? `curl -sI '${safeUrl}' 2>/dev/null | head -30`
      : `curl -sL '${safeUrl}' 2>/dev/null | head -500`
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024 })
    return { success: true, output: smartTruncate(output, 20_000) }
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
    return { success: false, output: `File not found: ${filePath}. Use list_directory or glob_files to verify the path.` }
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

// ── Task Management ──────────────────────────────────────────────
const taskStore: Array<{ id: string; title: string; description?: string; status: string; createdAt: string }> = []
let taskCounter = 0

function executeTaskCreate(args: Record<string, unknown>, _cwd: string): ToolResult {
  const id = `task-${++taskCounter}`
  const task = {
    id,
    title: String(args.title || ''),
    description: args.description ? String(args.description) : undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  taskStore.push(task)
  return { success: true, output: `Created task ${id}: ${task.title}` }
}

function executeTaskUpdate(args: Record<string, unknown>, _cwd: string): ToolResult {
  const id = String(args.id || '')
  const status = String(args.status || 'pending')
  const task = taskStore.find(t => t.id === id)
  if (!task) return { success: false, output: `Task not found: ${id}` }
  task.status = status
  return { success: true, output: `Updated ${id}: ${task.title} → ${status}` }
}

function executeTaskList(_cwd: string): ToolResult {
  if (taskStore.length === 0) return { success: true, output: 'No tasks.' }
  const lines = taskStore.map(t => {
    const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '●' : t.status === 'failed' ? '✗' : '○'
    return `${icon} ${t.id}: ${t.title} [${t.status}]`
  })
  return { success: true, output: lines.join('\n') }
}

// ── User Interaction ─────────────────────────────────────────────
function executeNotifyUser(args: Record<string, unknown>): ToolResult {
  const message = String(args.message || '')
  const level = String(args.level || 'info')
  const prefix = { info: 'INFO', success: 'OK', warning: 'WARN', error: 'ERROR' }[level] || 'NOTE'
  console.log(`\x1b[90m  [${prefix}] ${message}\x1b[0m`)
  return { success: true, output: `Notified user: ${message}` }
}

// ── Planning ─────────────────────────────────────────────────────
let planCounter = 0

function executeCreatePlan(args: Record<string, unknown>, cwd: string): ToolResult {
  const goal = String(args.goal || '')
  const steps = (args.steps as string[]) || []
  const plan = {
    id: `plan-${++planCounter}`,
    goal,
    steps: steps.map((s, i) => `${i + 1}. ${s}`),
    createdAt: new Date().toISOString(),
  }
  // Save plan to .orca/plans/
  try {
    const planDir = join(cwd, '.orca', 'plans')
    mkdirSync(planDir, { recursive: true })
    writeFileSync(join(planDir, `${plan.id}.json`), JSON.stringify(plan, null, 2), 'utf-8')
  } catch { /* ignore */ }
  return { success: true, output: `Plan ${plan.id}:\nGoal: ${goal}\n${plan.steps.join('\n')}` }
}

function executeVerifyPlan(args: Record<string, unknown>, cwd: string): ToolResult {
  const checks = (args.checks as string[]) || []
  const results: string[] = []
  for (const check of checks) {
    try {
      execSync(check, { cwd, encoding: 'utf-8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] })
      results.push(`✓ ${check}`)
    } catch {
      results.push(`✗ ${check}`)
    }
  }
  const allPass = results.every(r => r.startsWith('✓'))
  return { success: allPass, output: results.join('\n') }
}

// ── Web Search ───────────────────────────────────────────────────
function executeWebSearch(args: Record<string, unknown>): ToolResult {
  const query = String(args.query || '')
  if (!query) return { success: false, output: 'query is required.' }
  try {
    const encoded = encodeURIComponent(query)
    const cmd = `curl -sL 'https://html.duckduckgo.com/html/?q=${encoded}' 2>/dev/null | grep -oP 'href="https?://[^"]*"' | head -${Number(args.count) || 5} | sed 's/href="//;s/"$//'`
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 15_000, maxBuffer: 1024 * 1024 })
    if (!output.trim()) return { success: true, output: `No results for "${query}". Try fetch_url with a specific URL.` }
    return { success: true, output: `Search results for "${query}":\n${output}` }
  } catch {
    return { success: false, output: `Web search failed. Try fetch_url with a known URL instead.` }
  }
}

// ── MCP Server Discovery ─────────────────────────────────────────
function executeMcpListServers(cwd: string): ToolResult {
  const configPaths = [
    join(cwd, '.mcp.json'),
    join(cwd, '.orca', 'mcp.json'),
    join(process.env.HOME || '/tmp', '.orca', 'mcp.json'),
  ]
  const servers: string[] = []
  for (const p of configPaths) {
    if (existsSync(p)) {
      try {
        const config = JSON.parse(readFileSync(p, 'utf-8'))
        const mcpServers = config.mcpServers || config.servers || {}
        for (const [name, def] of Object.entries(mcpServers)) {
          const d = def as Record<string, unknown>
          servers.push(`${name}: ${d.command || d.url || 'unknown'} (${p})`)
        }
      } catch { /* ignore parse errors */ }
    }
  }
  if (servers.length === 0) {
    return { success: true, output: 'No MCP servers configured. Add servers to .mcp.json or .orca/mcp.json.' }
  }
  return { success: true, output: `MCP Servers:\n${servers.join('\n')}` }
}

// ── Notebook Edit ────────────────────────────────────────────────
function executeNotebookEdit(args: Record<string, unknown>, cwd: string): ToolResult {
  const filePath = resolve(cwd, String(args.path || ''))
  const cellIndex = Number(args.cell_index) || 0
  const content = String(args.content || '')
  const cellType = String(args.cell_type || 'code')

  if (cellIndex < 0) return { success: false, output: `Invalid cell_index: ${cellIndex}. Must be >= 0.` }
  if (!existsSync(filePath)) return { success: false, output: `Notebook not found: ${filePath}` }

  try {
    const nb = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!nb.cells || !Array.isArray(nb.cells)) {
      return { success: false, output: 'Invalid notebook format: missing cells array.' }
    }
    if (cellIndex >= nb.cells.length) {
      // Add new cell
      nb.cells.push({ cell_type: cellType, source: content.split('\n').map((l: string) => l + '\n'), metadata: {}, outputs: [] })
    } else {
      nb.cells[cellIndex].source = content.split('\n').map((l: string) => l + '\n')
      nb.cells[cellIndex].cell_type = cellType
    }
    writeFileSync(filePath, JSON.stringify(nb, null, 1), 'utf-8')
    return { success: true, output: `Updated cell ${cellIndex} in ${filePath}` }
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) }
  }
}

// ── Tool Search ──────────────────────────────────────────────────
function executeToolSearch(args: Record<string, unknown>): ToolResult {
  const query = String(args.query || '').toLowerCase()
  if (!query) return { success: false, output: 'query is required.' }

  const matches = TOOL_DEFINITIONS.filter(t => {
    const name = t.function.name.toLowerCase()
    const desc = t.function.description.toLowerCase()
    return name.includes(query) || desc.includes(query)
  })

  if (matches.length === 0) return { success: true, output: `No tools matching "${query}".` }
  const lines = matches.map(t => `${t.function.name}: ${t.function.description.slice(0, 80)}`)
  return { success: true, output: lines.join('\n') }
}
