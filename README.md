# Forge CLI

**Provider-neutral coding agent — 11 models · 41 tools · 8 hooks · multi-model collaboration.**

The one CLI that can do what no single-vendor CLI can: ask Claude, GPT, and Gemini the same question simultaneously, race them, or chain them as specialists.

```
     · ✦ ·
   ▄██████▄          Forge  v0.1.0
  ██████████         armature agent runtime
  ▀████████▀
    ██████           ▸ poe/claude-sonnet-4.6  200K ctx · 64K out  [yolo]
   ████████          ▸ ~/Projects/my-app
                     41 tools · 8 hooks
```

## Install

```bash
npm install -g @armature/forge-cli
export POE_API_KEY=your-poe-api-key
```

## Quick Start

```bash
forge chat                                    # interactive REPL
forge chat "explain this codebase"            # one-shot
forge run "fix the failing tests"             # task execution
forge council "SQL or NoSQL for this?" -n 5   # 5 models + judge
forge race "write a CSV parser"               # first model wins
forge pipeline "build REST API" --stages 5    # plan→code→review→fix→verify
```

## Multi-Model Collaboration (Unique Feature)

No single-vendor CLI can do this. Forge accesses 11 models from 9 vendors through one API key.

### Council Mode — `/council` or `forge council`

Ask N models the same question. A judge synthesizes the best answer.

```bash
forge council "is this code thread-safe?" -n 3
forge council "review for security issues" -n 5 -j claude-opus-4.6
```

```
╭── Council: 3 models ──╮
● claude-opus-4.6... 4.2s
● gpt-5.4... 2.1s
● gemini-3.1-pro... 3.8s

★ Verdict (claude-opus-4.6 as judge)
  All three agree on the race condition in line 42...
  Confidence: HIGH (3/3 agree)
─ 3 models · 12.1s · agreement: high ─
```

### Race Mode — `/race` or `forge race`

N models race. First good answer wins, rest cancelled.

```bash
forge race "write a quicksort in Python" -n 5
```

### Pipeline Mode — `/pipeline` or `forge pipeline`

Chain models as specialists. Each stage feeds into the next.

```bash
forge pipeline "build auth middleware" --plan claude-opus-4.6 --code gpt-5.4 --review gemini-3.1-pro
```

| Stage | Default Model | Role |
|-------|--------------|------|
| Plan | claude-opus-4.6 | Architecture, data flow, API design |
| Code | gpt-5.4 | Fast implementation |
| Review | gemini-3.1-pro | Bug/security/perf review (2M context) |
| Fix | gpt-5.4 | Address review findings |
| Verify | claude-opus-4.6 | Confirm fix matches plan |

## 11 Models via Poe

One API key, 9 vendors:

| Model | Vendor | Strength |
|-------|--------|----------|
| claude-opus-4.6 | Anthropic | Deep reasoning, careful analysis |
| claude-sonnet-4.6 | Anthropic | Fast + capable (default) |
| gpt-5.4 | OpenAI | Fast code generation |
| gemini-3.1-pro | Google | 2M context, multimodal |
| gemini-3.1-flash-lite | Google | Ultra-fast, cheap |
| gemma-4-31b | Google/Meta | Open-source, local-friendly |
| glm-5 | Zhipu | Chinese language excellence |
| grok-4.20-multi-agent | xAI | Multi-agent native |
| qwen3.6-plus | Alibaba | Math, reasoning |
| kimi-k2.5 | Moonshot | Long-context reasoning |
| minimax-m2.7 | MiniMax | Creative generation |

## 41 Agent Tools

Tools the model calls autonomously. Grouped by capability:

| Category | Tools | Count |
|----------|-------|-------|
| File I/O | read, write, edit, multi_edit, patch, delete, move, copy, mkdir, file_info | 10 |
| Search | search, glob, find_definition, find_references, tree, count_lines, tool_search | 7+(1) |
| Git | status, diff, log, commit | 4 |
| Execution | run_command, run_background, check_port, sleep | 4 |
| Agent/Swarm | spawn_agent, delegate_task | 2 |
| Task Mgmt | task_create, task_update, task_list | 3 |
| Planning | create_plan, verify_plan | 2 |
| Interaction | ask_user, notify_user | 2 |
| Web | fetch_url, web_search | 2 |
| MCP | mcp_list_servers, mcp_list_resources, mcp_read_resource | 3 |
| Notebook | notebook_edit | 1 |

9 tools require confirmation in `--safe` mode: write, edit, multi_edit, patch, delete, move, run_command, run_background, git_commit.

## 8 Lifecycle Hooks

Configure in `.armature/hooks.json`. Shell commands receive JSON stdin, return JSON stdout.

| Hook | When | Can Block? |
|------|------|------------|
| PreToolUse | Before tool execution | Yes (exit 1 = block) |
| PostToolUse | After tool execution | No |
| SessionStart | REPL startup | No |
| SessionEnd | Clean exit | No |
| PreCompact | Before /compact | No |
| PostCompact | After /compact | No |
| UserPromptSubmit | Before prompt to model | Yes |
| SubagentStart | Sub-agent spawn | No |

## 25 Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands + tips |
| `/models` | Interactive model picker (1-11) |
| `/model set <name>` | Switch model mid-session |
| `/council <prompt>` | Multi-model council |
| `/race <prompt>` | Multi-model race |
| `/pipeline <prompt>` | Multi-model pipeline |
| `/clear` | Clear conversation |
| `/compact` | Keep last 2 turns |
| `/system <prompt>` | Set system prompt |
| `/diff` | Show git diff |
| `/git <cmd>` | Run git command |
| `/save [name]` | Save session |
| `/load [name]` | Load session |
| `/sessions` | List saved sessions |
| `/undo` | Revert last file write |
| `/hooks` | Show registered hooks |
| `/retry` | Retry last message |
| `/history` `/tokens` `/stats` | Session metrics |
| `/cwd` | Working directory |
| `/exit` | Exit with summary |

## Permission Modes

| Mode | Flag | Default |
|------|------|---------|
| YOLO | (none) | **Yes** — auto-approve, actions visible |
| Safe | `--safe` | No — interactive y/n + diff preview |

## Streaming Markdown

- Code blocks: box-drawing borders (╭╮╰╯│) + syntax highlighting (JS/TS, Python, Shell, JSON)
- Inline: **bold**, *italic*, `code` (dark background)
- Lists, blockquotes, headings, links, horizontal rules

## SOTA Agent Capabilities

Features that close the gap between "tool" and "agent":

| Capability | What It Does | Why It Matters |
|-----------|-------------|----------------|
| Project Context Loader | Auto-detects type, framework, test runner, deps | Agent knows the project from turn 1 |
| Smart Output Truncation | 8K limit with summary header (line count + file list) | Prevents context pollution from large grep results |
| Error Self-Correction | Failed tools return recovery hints ("use read_file first") | Model self-corrects without human intervention |
| Shell Injection Protection | All user inputs shellEscaped before exec | Security baseline for production agent |
| Unlimited Agent Loop | Auto-continue on truncation, incomplete text detection | Tasks complete without artificial limits |
| Multi-edit Atomicity | Failed batch edits leave file unchanged | No partial corruption on error |

Tested: 289 tests across 18 files, 14 rounds covering 10 SOTA dimensions.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Forge CLI  v0.1.0                                  │
│  5,800+ LOC · 20 source files · 289 tests           │
├─────────────────────────────────────────────────────┤
│  SOTA Agent Layer                                   │
│  project context · smart truncation · error hints   │
│  shell escape · boundary protection                 │
├─────────────────────────────────────────────────────┤
│  Multi-Model Engine                                 │
│  council · race · pipeline                          │
│  11 models × 9 vendors via Poe proxy                │
├─────────────────────────────────────────────────────┤
│  Agent Runtime                                      │
│  41 tools · 8 hooks · YOLO/safe · sub-agents        │
│  StreamMarkdown · session persistence · MCP client   │
├─────────────────────────────────────────────────────┤
│  OpenAI-compat Provider                             │
│  Unlimited agent loop · model-aware max_tokens      │
│  Auto-continue on truncation · proxy support         │
├─────────────────────────────────────────────────────┤
│  @armature/sdk  (optional, native Anthropic path)   │
│  51 tools · full MCP · agent infrastructure          │
└─────────────────────────────────────────────────────┘
```

## Configuration

```
CLI flags  >  ENV vars  >  .armature.json  >  ~/.armature/config.json
```

## License

MIT

---

Maurice | maurice_wen@proton.me
