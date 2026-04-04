# Forge CLI

**Provider-neutral coding agent — Claude, GPT, Gemini through one CLI. 41 tools. 8 hooks. YOLO by default.**

```
        · ✦ ·
      ▄██████▄         Forge  v0.1.0
     ██████████        armature agent runtime
     ▀████████▀
       ██████          ▸ poe/Claude-Sonnet-4  200K ctx · 64K out
      ████████         ▸ ~/Projects/my-app  [yolo]
```

## Install

```bash
npm install -g @armature/forge-cli
export POE_API_KEY=your-poe-api-key
```

## Quick Start

```bash
# Interactive REPL (multi-turn, multi-model, streaming markdown)
forge chat

# One-shot query
forge chat "explain this codebase"

# Task execution with full agent loop
forge run "fix the failing tests"

# Switch model mid-session
forge chat -m GPT-4o

# Safe mode (permission prompts for dangerous tools)
forge chat --safe
```

## 41 Agent Tools

The model calls these tools autonomously to complete tasks.

### File I/O (10)

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents (supports line ranges) |
| `write_file` | Create or overwrite a file |
| `edit_file` | Surgical string replacement (must match uniquely) |
| `multi_edit` | Batch replacements in one call |
| `patch_file` | Apply unified diff |
| `delete_file` | Remove a file |
| `move_file` | Move or rename |
| `copy_file` | Copy a file |
| `create_directory` | mkdir -p |
| `file_info` | File metadata (size, modified, lines) |

### Search & Navigation (8)

| Tool | Description |
|------|-------------|
| `search_files` | Regex search across files (grep) |
| `glob_files` | Find files by pattern (git ls-files + find) |
| `list_directory` | List directory contents (recursive to 3 levels) |
| `find_definition` | Find function/class/type definitions (12 patterns, 12 languages) |
| `find_references` | Find all usages of a symbol |
| `directory_tree` | Recursive tree view |
| `count_lines` | Lines of code per file |
| `tool_search` | Search available tools by keyword |

### Git (4)

| Tool | Description |
|------|-------------|
| `git_status` | Staged, modified, untracked files |
| `git_diff` | Working tree or staged diff |
| `git_log` | Recent commits (filterable by file) |
| `git_commit` | Stage + commit (⚠ requires confirmation in --safe mode) |

### Execution (4)

| Tool | Description |
|------|-------------|
| `run_command` | Shell command (30s timeout, 1MB buffer) |
| `run_background` | Long-running command with PID tracking |
| `check_port` | Check if a port is in use |
| `sleep` | Wait with reason annotation |

### Agent / Swarm (2)

| Tool | Description |
|------|-------------|
| `spawn_agent` | Spawn sub-agent with full tool access |
| `delegate_task` | Delegate task to specialist sub-agent |

### Task Management (3)

| Tool | Description |
|------|-------------|
| `task_create` | Create task to track progress |
| `task_update` | Update status (pending/in_progress/completed/failed) |
| `task_list` | List all tasks with status |

### Planning (2)

| Tool | Description |
|------|-------------|
| `create_plan` | Create structured execution plan |
| `verify_plan` | Verify plan completion with checks |

### User Interaction (2)

| Tool | Description |
|------|-------------|
| `ask_user` | Ask user a question (with optional multiple-choice) |
| `notify_user` | Send notification (info/success/warning/error) |

### Web (2)

| Tool | Description |
|------|-------------|
| `fetch_url` | HTTP GET a URL (text/json/headers) |
| `web_search` | Web search via DuckDuckGo |

### MCP (3)

| Tool | Description |
|------|-------------|
| `mcp_list_servers` | List connected MCP servers |
| `mcp_list_resources` | List MCP server resources |
| `mcp_read_resource` | Read resource by URI |

### Notebook (1)

| Tool | Description |
|------|-------------|
| `notebook_edit` | Edit Jupyter notebook cells |

## 8 Lifecycle Hooks

Hooks are shell commands triggered at lifecycle events. Configure in `.armature/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "run_command", "command": "node scripts/validate-cmd.js" }
    ],
    "PostToolUse": [
      { "matcher": ".*", "command": "bash scripts/log-tool.sh" }
    ],
    "SessionStart": [
      { "command": "bash scripts/load-context.sh" }
    ]
  }
}
```

| Hook | When | Can Block? |
|------|------|------------|
| `PreToolUse` | Before tool execution | Yes (non-zero exit = block) |
| `PostToolUse` | After tool execution | No |
| `SessionStart` | REPL startup | No |
| `SessionEnd` | Clean exit | No |
| `PreCompact` | Before /compact | No |
| `PostCompact` | After /compact | No |
| `UserPromptSubmit` | Before prompt sent to model | Yes |
| `SubagentStart` | Sub-agent spawn | No |

Hooks receive JSON on stdin with event context. Return JSON to modify behavior:
```json
{ "continue": false, "stopReason": "Blocked: unsafe command" }
```

## 22 Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands + tips |
| `/model`, `/m` | Show current model |
| `/model set <name>` | Switch model mid-session |
| `/models` | Interactive model picker (1-11) |
| `/clear` | Clear conversation |
| `/compact` | Keep last 2 turns |
| `/system <prompt>` | Set system prompt |
| `/history` | Show message counts |
| `/tokens` | Token breakdown |
| `/stats` | Session statistics |
| `/retry`, `/r` | Retry last message |
| `/diff` | Show git diff |
| `/git <cmd>` | Run git command |
| `/save [name]` | Save session to disk |
| `/load [name]` | Load saved session |
| `/sessions` | List saved sessions |
| `/undo` | Revert last file write |
| `/hooks` | Show registered hooks |
| `/cwd` | Working directory |
| `/exit`, `/quit` | Exit with summary |

## Permission Modes

| Mode | Flag | Behavior |
|------|------|----------|
| **YOLO** (default) | (none) | Auto-approve all tools. Actions visible in output. |
| **Safe** | `--safe` | Interactive y/n prompt for dangerous tools + diff preview |

9 tools are classified as dangerous: `write_file`, `edit_file`, `multi_edit`, `patch_file`, `delete_file`, `move_file`, `run_command`, `run_background`, `git_commit`.

## Streaming Markdown

Output is rendered with line-buffered streaming markdown:

- **Headers**: cyan bold
- **Bold/italic**: ANSI formatting
- **Inline code**: dark background
- **Code blocks**: box-drawing borders (╭╮╰╯│) with syntax highlighting (JS/TS, Python, Shell, JSON)
- **Lists**: cyan bullet dots / numbered
- **Blockquotes**: │ border with italic
- **Links**: text + (url) format

## Context Management

- Usage bar in turn summary: `ctx ████████░░░░ 45%` (green/yellow/red)
- `/compact` keeps last 2 turns
- Auto context size warning at 50K chars
- Session auto-save on clean exit

## Multi-Model via Poe

One API key, 11 models:

| Model | Provider |
|-------|----------|
| Claude-Sonnet-4 | Anthropic |
| Claude-3.7-Sonnet | Anthropic |
| Claude-3-Haiku | Anthropic |
| GPT-4o | OpenAI |
| GPT-4.1 | OpenAI |
| GPT-4.1-mini | OpenAI |
| o3 | OpenAI |
| o4-mini | OpenAI |
| Gemini-2.5-Pro | Google |
| Gemini-2.5-Flash | Google |
| Gemini-2.0-Flash | Google |

## Configuration

```
CLI flags  >  ENV vars  >  .armature.json  >  ~/.armature/config.json
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Forge CLI  (this repo)                     │
│  41 tools · 8 hooks · 22 commands           │
│  StreamMarkdown · YOLO/Safe · Sub-agents    │
├─────────────────────────────────────────────┤
│  OpenAI-compat Provider (Poe/OpenRouter)    │
│  Unlimited agent loop · Model-aware tokens  │
├─────────────────────────────────────────────┤
│  @armature/sdk  (optional, native path)     │
│  51 tools · MCP · Full agent infrastructure │
└─────────────────────────────────────────────┘
```

## Tool Status

38 of 41 tools are fully functional. 3 tools need MCP infrastructure to connect:

| Tool | Status | Why |
|------|--------|-----|
| `mcp_list_resources` | Stub | Needs active MCP server connections |
| `mcp_read_resource` | Stub | Needs active MCP server connections |
| `ask_user` | Stub | Needs async readline in generator context |

`mcp_list_servers` works (reads `.mcp.json` config). Full MCP client planned for v0.2.

## License

MIT

---

Maurice | maurice_wen@proton.me
