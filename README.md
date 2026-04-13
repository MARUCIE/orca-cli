# Orca CLI

**Provider-neutral coding agent — 9 providers · 41 tools · MCP server · 5 modes · multi-model collaboration.**

The one CLI that can do what no single-vendor CLI can: ask Claude, GPT, and Gemini the same question simultaneously, race them, or chain them as specialists. Works with any OpenAI-compatible provider.

```
       ..:::....
    .::------::::..          Orca  v0.6.0
  .::--========----::::..    provider-neutral agent runtime
.:--==+++*****+++===---::::..
.:-=++**#########**++==---::..
.:-=+*##############*++==--::..   ▸ ~/Projects/my-app
.:-=+*##############*++==-::..    41 tools · 8 hooks
.:-=++**#########**++==---::..
.:--==+++*****+++===---::::..
  .::--========----::::..
    .::------::::..
       ..:::....
```

## Install

```bash
npm install -g orca-cli
```

Any ONE of these keys gets you started:
```bash
export GOOGLE_API_KEY=...        # Google Gemini
export ANTHROPIC_API_KEY=...     # Anthropic Claude
export OPENAI_API_KEY=...        # OpenAI GPT
export POE_API_KEY=...           # Poe (aggregator: all vendors via 1 key)
export OPENROUTER_API_KEY=...    # OpenRouter (aggregator)
```

## Quick Start

```bash
orca chat                                    # interactive REPL
orca chat "explain this codebase"            # one-shot
orca run "fix the failing tests"             # task execution
orca council "SQL or NoSQL for this?" -n 5   # 5 models + judge
orca race "write a CSV parser"               # first model wins
orca pipeline "build REST API" --stages 5    # plan→code→review→fix→verify
orca stats                                   # token usage + runtime dashboard
orca session list                            # saved sessions
orca doctor                                 # runtime/config diagnostics
orca logs errors                             # tail warning/error log
orca pr 123                                  # checkout + review PR
orca serve --port 9100                       # headless HTTP server
orca serve --mcp                             # MCP server over stdio
orca providers                               # list configured providers
```

## Multi-Model Collaboration (Unique Feature)

No single-vendor CLI can do this. Orca accesses 11 models from 9 vendors through one API key.

### Council Mode — `/council` or `orca council`

Ask N models the same question. A judge synthesizes the best answer.

```bash
orca council "is this code thread-safe?" -n 3
orca council "review for security issues" -n 5 -j claude-opus-4.6
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

### Race Mode — `/race` or `orca race`

N models race. First good answer wins, rest cancelled.

```bash
orca race "write a quicksort in Python" -n 5
```

### Pipeline Mode — `/pipeline` or `orca pipeline`

Chain models as specialists. Each stage feeds into the next.

```bash
orca pipeline "build auth middleware" --plan claude-opus-4.6 --code gpt-5.4 --review gemini-3.1-pro
```

| Stage | Default Model | Role |
|-------|--------------|------|
| Plan | claude-opus-4.6 | Architecture, data flow, API design |
| Code | gpt-5.4 | Fast implementation |
| Review | gemini-3.1-pro | Bug/security/perf review (2M context) |
| Fix | gpt-5.4 | Address review findings |
| Verify | claude-opus-4.6 | Confirm fix matches plan |

## 9 Providers

Works with any OpenAI-compatible endpoint. Configure in `~/.orca/config.json`:

| Provider | Type | API Key Env |
|----------|------|-------------|
| anthropic | Direct | `ANTHROPIC_API_KEY` |
| google | Direct | `GOOGLE_API_KEY` |
| openai | Direct | `OPENAI_API_KEY` |
| poe | Aggregator | `POE_API_KEY` |
| openrouter | Aggregator | `OPENROUTER_API_KEY` |
| deepseek | Direct | `DEEPSEEK_API_KEY` |
| groq | Direct | `GROQ_API_KEY` |
| xai | Direct | `XAI_API_KEY` |
| local | Direct | (Ollama at localhost:11434) |

**Aggregators** (Poe, OpenRouter) route to all vendors via one API key — ideal for council/race/pipeline.
**Direct** providers connect to each vendor's own API.

Multi-model routing: aggregator first, direct fallback per model.

`orca providers` now shows per-provider context window, approximate pricing, and caution metadata for the default model, and `orca providers test` surfaces the same metadata before connectivity checks.

## Model Diversity (via aggregator)

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
| Execution | run_command, run_background (`notify_on_complete`), check_port, sleep | 4 |
| Agent/Swarm | spawn_agent, delegate_task | 2 |
| Task Mgmt | task_create, task_update, task_list | 3 |
| Planning | create_plan, verify_plan | 2 |
| Interaction | ask_user, notify_user | 2 |
| Web | fetch_url, web_search | 2 |
| MCP | mcp_list_servers, mcp_list_resources, mcp_read_resource | 3 |
| Notebook | notebook_edit | 1 |

9 tools require confirmation in `--safe` mode: write, edit, multi_edit, patch, delete, move, run_command, run_background, git_commit.

## 8 Lifecycle Hooks

Configure in `.orca/hooks.json`. Shell commands receive JSON stdin, return JSON stdout.

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

## 27 Top-Level / Slash Surfaces

| Command | Description |
|---------|-------------|
| `/help` | Show all commands + tips |
| `/models` | Interactive model picker with provider/context/pricing |
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
| `/jobs` | List tracked background jobs |
| `/undo` | Revert last file write |
| `/hooks` | Show registered hooks |
| `/retry` | Retry last message |
| `/history` `/tokens` `/stats` | Session metrics |
| `/cwd` | Working directory |
| `/exit` | Exit with summary |

## Runtime Logs

Orca writes local runtime logs under `~/.orca/logs/` or `$ORCA_HOME/logs/`:

- `agent.log` — info, warn, error
- `errors.log` — warn, error only

Use:

```bash
orca logs
orca logs errors
orca logs --lines 100
```

## Doctor

Run a local runtime health check:

```bash
orca doctor
orca doctor --json
orca doctor --cwd ~/Projects/my-app
```

`orca doctor` now reports malformed project/global JSON config files explicitly, instead of forcing users to infer the problem from scattered stderr warnings.

## Serve Runtime Metadata

`orca serve` now exposes the same runtime metadata surfaces as the CLI:

- `GET /health` — provider + model metadata
- `GET /providers` — provider list with model metadata
- `GET /doctor` — structured runtime diagnostics

## Stats Dashboard

`orca stats` now combines:

- usage and cost summary
- per-model breakdown
- runtime health snapshot from `doctor`
- recent error log tail

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
| Oversized Tool Result Persistence | Saves full oversized output to `~/.orca/tool-results/` and returns an artifact path | Prevents destructive truncation while keeping context small |
| Error Self-Correction | Failed tools return recovery hints ("use read_file first") | Model self-corrects without human intervention |
| Tool Argument Coercion | Normalizes stringified numbers, booleans, and arrays to tool schema types | Improves GPT/Codex tool-call reliability |
| Provider-Aware Model Catalog | `/model` and `/models` surface provider, context window, approximate pricing, and cautions | Makes live model switching safer and more informed |
| Shell Injection Protection | All user inputs shellEscaped before exec | Security baseline for production agent |
| Unlimited Agent Loop | Auto-continue on truncation, incomplete text detection | Tasks complete without artificial limits |
| Multi-edit Atomicity | Failed batch edits leave file unchanged | No partial corruption on error |
| Background Completion Notifications | `run_background` jobs notify the REPL when they finish, and `/jobs` shows tracked state | Agent can keep working without manual PID polling |

Tested: 688 tests across 45 files, 10/10 SOTA benchmark.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Orca CLI  v0.6.0                                   │
│  13,000+ LOC · 63 source files · 688 tests          │
├─────────────────────────────────────────────────────┤
│  New in v0.6.0 — Mode Wiring + Threads + Guidance   │
│  /mode command · thread memory · guidance injection  │
├─────────────────────────────────────────────────────┤
│  v0.5.0 — MCP Server + Modes + Discovery            │
│  MCP server hosting · 5 behavioral modes             │
│  AGENTS.md auto-discovery · hierarchical guidance    │
├─────────────────────────────────────────────────────┤
│  v0.4.0 — SOTA Gap Closure                          │
│  harness layer · sub-agent isolation · sandbox       │
│  skills engine · webhook gateway · DNA capsules      │
├─────────────────────────────────────────────────────┤
│  Multi-Model Engine                                 │
│  council · race · pipeline                          │
│  9 providers · aggregator or direct per-model        │
├─────────────────────────────────────────────────────┤
│  Agent Runtime + Harness Layer                      │
│  41 tools · 10 hooks · YOLO/safe · sub-agents       │
│  verification gate · loop detector · context monitor │
├─────────────────────────────────────────────────────┤
│  Skills · Sandbox · Gateway · Memory                │
│  swarm/pipeline/loop · Seatbelt/bwrap · webhook     │
│  DNA capsules · knowledge compounding · Telegram     │
├─────────────────────────────────────────────────────┤
│  OpenAI-compat Provider + SQLite Usage Tracking     │
│  429 auto-retry · model-aware max_tokens · SSE      │
│  headless serve · PR review · session resume         │
└─────────────────────────────────────────────────────┘
```

## Configuration

```
CLI flags  >  ENV vars  >  .orca.json  >  ~/.orca/config.json
```

## License

MIT

---

Maurice | maurice_wen@proton.me
