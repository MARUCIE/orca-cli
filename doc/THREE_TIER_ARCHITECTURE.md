# Three-Tier Architecture — Orca Ecosystem

**Date**: 2026-04-04
**Version**: 1.0
**Scope**: SDK + CLI + AI-OS complete capability inventory

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 3: OrcaOS (AI-OS)                     │
│  Launcher · 112 Skills · 38 Core Modules · 16 Harness Modules   │
│  53 Start Functions · Skill Groups · DNA Capsules · Cron Jobs    │
├─────────────────────────────────────────────────────────────────┤
│                    Layer 2: Orca CLI (Product)                   │
│  REPL · 3 Commands · 13 Slash Commands · 5 Agent Tools          │
│  Multi-Model · Poe/OpenRouter Proxy · Streaming · Cost Tracking  │
├─────────────────────────────────────────────────────────────────┤
│                  Layer 1: Orca Agent SDK (Foundation)               │
│  Agent Engine · 51 Built-in Tools · 12 Core Contracts           │
│  2 Provider Adapters · Eval Framework · MCP Client (7 transports)│
└─────────────────────────────────────────────────────────────────┘
```

### Dependency Direction

```
OrcaOS ──depends-on──→ Orca CLI ──optional-dep──→ Orca Agent SDK
                              │
                              └──direct-dep──→ OpenAI SDK (Poe proxy)
```

### Repository Map

| Layer | Repo | URL | Language | Tests |
|-------|------|-----|----------|-------|
| L1: SDK | `orca-agent-sdk` | github.com/MARUCIE/orca-agent-sdk | TypeScript | 170 / 27 files |
| L2: CLI | `orca-cli` | github.com/MARUCIE/orca-cli | TypeScript | 22 / 3 files |
| L3: AI-OS | `00-AI-Fleet` | local (private) | Python + Bash | Harness-gated |

---

## 2. Layer 1: Orca Agent SDK (Foundation)

### 2.1 Package Structure

| Package | Purpose | Files | Exports |
|---------|---------|-------|---------|
| `@orca/sdk` | Agent engine entry point | 2000+ src files | `createAgent`, `Agent`, `query`, 50+ tools |
| `@orca/core` | Provider-neutral IR | 13 modules | 12 contracts + types |
| `@orca/provider-anthropic` | Anthropic codec | 2 modules | Adapter factory + codec |
| `@orca/provider-openai` | OpenAI codec | 2 modules | Adapter factory + codec |
| `@orca/eval` | Quality evaluation | 6 modules | Trajectory + tool validation + golden |

### 2.2 Core Contracts (packages/core — 12 modules)

| # | Contract | Interface | Purpose |
|---|----------|-----------|---------|
| 1 | `messages.ts` | `AgentMessage`, `MessagePart` | Provider-neutral message IR with text, image, document, tool-call, tool-result parts |
| 2 | `tools.ts` | `AgentToolDefinition`, `AgentToolCall` | Tool schema + call/result contracts for cross-provider tool translation |
| 3 | `provider.ts` | `ProviderAdapter<Req,Event,Msg,Tool>` | 5-method contract: `prepare`, `translateMessages`, `translateTools`, `parseEvent`, `normalizeUsage` |
| 4 | `capabilities.ts` | `ProviderCapabilities` | Declares what a provider supports: streaming, tools, vision, thinking, MCP |
| 5 | `trace.ts` | `AgentTracer`, `BufferTracer`, `ConsoleTracer` | 8 span types, `startSpan`/`endSpan`/`emitMetric` helpers, `noopTracer` default |
| 6 | `checkpoint.ts` | `CheckpointStore`, `InMemoryCheckpointStore` | Save/load/list/delete durable state snapshots for agent recovery |
| 7 | `guardrails.ts` | `InputGuardrail`, `OutputGuardrail`, `ToolGuardrail` | pass/warn/block verdicts with short-circuit pipeline runners |
| 8 | `handoff.ts` | `HandoffRequest`, `HandoffResult`, `InMemoryHandoffRouter` | Inter-agent delegation with 3 modes (delegate/transfer/parallel) + 4 permission policies |
| 9 | `memory.ts` | `MemoryStore`, `InMemoryMemoryStore` | 7 memory types (user/feedback/project/reference/episodic/procedural/fact), 3 search modes |
| 10 | `workflow.ts` | `WorkflowNode`, `WorkflowEdge`, `WorkflowEngine` | State graph with conditional branching, parallel execution, HITL interrupt/resume |
| 11 | `mcpServer.ts` | `MCPServer`, `InMemoryMCPServer` | MCP server contract: tools/resources/prompts/sampling capabilities |
| 12 | `runManifest.ts` | `RunManifest`, `StyleDescriptor` | Style-first runtime descriptor mapping intent to execution style |

### 2.3 Built-in Tools (51 tools across 51 directories)

#### File System (6)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 1 | `FileReadTool` | Read file contents with line range support | Always |
| 2 | `FileWriteTool` | Create or overwrite files | Always |
| 3 | `FileEditTool` | Exact string replacement in files | Always |
| 4 | `GlobTool` | Fast file pattern matching (glob) | Default (disabled with embedded search) |
| 5 | `GrepTool` | Content search with regex (ripgrep) | Default (disabled with embedded search) |
| 6 | `NotebookEditTool` | Edit Jupyter notebook cells | Always |

#### Shell Execution (3)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 7 | `BashTool` | Execute bash commands with timeout | Always |
| 8 | `PowerShellTool` | Execute PowerShell commands (Windows) | Platform: Windows |
| 9 | `REPLTool` | Interactive REPL for prototyping | USER_TYPE=ant |

#### Web & Network (3)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 10 | `WebFetchTool` | Fetch web pages and API endpoints | Always |
| 11 | `WebSearchTool` | Search the web for information | Always |
| 12 | `WebBrowserTool` | Full browser automation | WEB_BROWSER_TOOL |

#### Agent Orchestration (5)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 13 | `AgentTool` | Spawn subagent for complex tasks | Always |
| 14 | `SendMessageTool` | Send message to another agent | Always (lazy require) |
| 15 | `TeamCreateTool` | Create agent team/swarm | AGENT_SWARMS |
| 16 | `TeamDeleteTool` | Delete agent team | AGENT_SWARMS |
| 17 | `BriefTool` | Send status update to user (SendUserMessage) | Always |

#### Task Management (6)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 18 | `TaskCreateTool` | Create structured task | TASKS_V2 |
| 19 | `TaskUpdateTool` | Update task status/description | TASKS_V2 |
| 20 | `TaskGetTool` | Get task details | TASKS_V2 |
| 21 | `TaskListTool` | List all tasks | TASKS_V2 |
| 22 | `TaskStopTool` | Stop a running task | Always |
| 23 | `TaskOutputTool` | Get task output/result | Always |

#### Planning & Workflow (5)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 24 | `EnterPlanModeTool` | Switch to planning mode | Always |
| 25 | `ExitPlanModeV2Tool` | Exit planning mode | Always |
| 26 | `VerifyPlanExecutionTool` | Verify plan was executed correctly | VERIFY_PLAN |
| 27 | `TodoWriteTool` | Write todo/task list | Always |
| 28 | `WorkflowTool` | Execute workflow scripts | WORKFLOW_SCRIPTS |

#### MCP & Protocol (6)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 29 | `ListMcpResourcesTool` | List MCP server resources | Always |
| 30 | `ReadMcpResourceTool` | Read a specific MCP resource | Always |
| 31 | `McpAuthTool` | Authenticate with MCP server | Always |
| 32 | `MCPTool` | Direct MCP tool invocation | Always |
| 33 | `ToolSearchTool` | Fuzzy search available tools | Optimistic check |
| 34 | `DiscoverSkillsTool` | Discover available skills | Always |

#### Git & Environment (3)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 35 | `EnterWorktreeTool` | Enter git worktree for isolation | WORKTREES |
| 36 | `ExitWorktreeTool` | Exit git worktree | WORKTREES |
| 37 | `SkillTool` | Execute a registered skill | Always |

#### Scheduling & Remote (4)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 38 | `CronCreateTool` | Create scheduled cron job | AGENT_TRIGGERS |
| 39 | `CronDeleteTool` | Delete cron job | AGENT_TRIGGERS |
| 40 | `CronListTool` | List cron jobs | AGENT_TRIGGERS |
| 41 | `RemoteTriggerTool` | Trigger remote agent execution | AGENT_TRIGGERS_REMOTE |

#### User Interaction (3)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 42 | `AskUserQuestionTool` | Ask user a question (HITL) | Always |
| 43 | `SendUserFileTool` | Send file to user | KAIROS |
| 44 | `PushNotificationTool` | Push notification to user device | KAIROS_PUSH_NOTIFICATION |

#### Context & Output Management (6)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 45 | `SyntheticOutputTool` | Generate structured output | Always |
| 46 | `SnipTool` | Snip/compress context history | HISTORY_SNIP |
| 47 | `ConfigTool` | Read/write agent configuration | USER_TYPE=ant |
| 48 | `SleepTool` | Pause execution for duration | PROACTIVE/KAIROS |
| 49 | `ReviewArtifactTool` | Review generated artifacts | Always |
| 50 | `TungstenTool` | Virtual terminal (Ant-native) | USER_TYPE=ant |

#### Monitoring & Diagnostics (3)

| # | Tool | Description | Feature Gate |
|---|------|-------------|-------------|
| 51 | `MonitorTool` | Monitor system metrics | MONITOR_TOOL |
| 52 | `TerminalCaptureTool` | Capture terminal output | TERMINAL_PANEL |
| 53 | `CtxInspectTool` | Inspect context state | CONTEXT_COLLAPSE |

### 2.4 Provider Bridge (14 seam modules)

| Module | Responsibility |
|--------|---------------|
| `providerSelection.ts` | Canonical provider/env seam for transport-family selection |
| `providerAdapter.ts` | Provider adapter factory |
| `providerRuntime.ts` | Runtime lifecycle management |
| `providerRequestBridge.ts` | Message translation (image/document/MCP history) |
| `providerRequestMetadata.ts` | Beta headers, request IDs, Bedrock extra-body |
| `providerStreamBridge.ts` | Stream event routing to sub-handlers |
| `providerStreamContent.ts` | Content block start/delta mutation |
| `providerMessageStart.ts` | Message start usage/research capture |
| `providerMessageFinalization.ts` | Block stop + assistant message assembly |
| `providerMessageDelta.ts` | Message delta usage/stop-reason writeback |
| `providerMessageDeltaEffects.ts` | Cost/refusal/recovery side effects |
| `providerStreamCompletion.ts` | Incomplete stream fallback detection |
| `providerToolBridge.ts` | Tool schema translation |
| `providerTransport.ts` + `Client.ts` | Transport selection + client bootstrap |

### 2.5 MCP Client (7 transports)

| Transport | Protocol |
|-----------|----------|
| stdio | Standard input/output subprocess |
| SSE | Server-Sent Events (HTTP) |
| HTTP | HTTP request/response |
| WebSocket | Full-duplex WebSocket |
| SDK | In-process SDK binding |
| Proxy | Proxy-forwarded MCP |
| CloudAI Proxy | Claude.ai proxy transport |

### 2.6 Eval Framework (packages/eval)

| Module | Capability |
|--------|-----------|
| `trajectory.ts` | Ordered/unordered step matching, optional steps, input validation |
| `toolValidation.ts` | maxCalls, forbidden tools, required/forbidden input patterns |
| `golden.ts` | Fingerprint-based transcript comparison, similarity scoring |
| `runner.ts` | Combined eval pipeline: trajectory + validation + golden |

### 2.7 Style-First Runtime

| Style | Intent | Provider Routing |
|-------|--------|-----------------|
| coding | Write/edit code, fix bugs | Prefer high-reasoning models |
| research | Gather information, analyze | Prefer web-capable models |
| ops | System administration, deployment | Prefer tool-heavy models |
| support | User assistance, Q&A | Prefer fast models |
| workflow | Multi-step automation | Prefer reliable models |
| realtime_voice | Voice interaction | Prefer low-latency models |

---

## 3. Layer 2: Orca CLI (Product)

### 3.1 Module Structure

| File | Lines | Purpose |
|------|-------|---------|
| `bin/orca.ts` | 23 | Entry point with SIGINT/SIGTERM handlers |
| `commands/chat.ts` | 780+ | REPL + one-shot chat + multi-turn + slash commands |
| `commands/init.ts` | 40 | Initialize .orca/ config |
| `commands/run.ts` | 170 | Task execution with acceptEdits default |
| `config.ts` | 240 | 3-tier config resolver + Zod schema + provider auto-detect |
| `output.ts` | 260 | Streaming output + tool display + cost + errors + session summary |
| `markdown.ts` | 70 | Markdown rendering via marked-terminal |
| `providers/openai-compat.ts` | 200 | OpenAI-compatible proxy with function calling agent loop |
| `tools.ts` | 270 | 5 built-in tools with execution layer |
| `program.ts` | 30 | Commander.js program assembly |
| `index.ts` | 5 | Public API exports |
| `types.d.ts` | 4 | Type declarations for marked-terminal |

### 3.2 CLI Commands

| Command | Description | Modes |
|---------|-------------|-------|
| `orca chat [prompt]` | Interactive REPL or one-shot query | Streaming, JSON |
| `orca run <task>` | Execute task with agent tools | acceptEdits default |
| `orca init` | Create ~/.orca/ + .orca.json | Global + project |

### 3.3 Slash Commands (13)

| Command | Category | Description |
|---------|----------|-------------|
| `/help`, `/h`, `/?` | Info | Show all commands |
| `/model`, `/m` | Model | Show current provider and model |
| `/model set <name>` | Model | Switch model mid-session (history preserved) |
| `/models` | Model | Interactive numbered picker (1-11) |
| `/1` through `/11` | Model | Quick switch by number |
| `/clear` | Session | Clear conversation history (keep system prompt) |
| `/compact` | Session | Keep last 2 turns, drop older messages |
| `/system <prompt>` | Session | View or set system prompt |
| `/history` | Info | Show user/assistant/system message counts + char total |
| `/tokens` | Info | Detailed input/output/total token breakdown |
| `/stats` | Info | Full session: model, turns, tokens, context chars, duration |
| `/retry`, `/r` | Action | Retry last message (removes last turn, re-sends) |
| `/cwd` | Info | Show working directory |
| `/exit`, `/quit`, `/q` | Control | Exit with session summary |

### 3.4 Agent Tools (5 via OpenAI function calling)

| # | Tool | Args | Limits | Description |
|---|------|------|--------|-------------|
| 1 | `read_file` | path, start_line?, end_line? | 300 lines max | Read file with optional line range |
| 2 | `write_file` | path, content | Confirmation shown | Create or overwrite file |
| 3 | `list_directory` | path, recursive? | 200 entries, 3 levels | List files and directories |
| 4 | `run_command` | command, cwd? | 30s timeout, 10KB output | Execute shell command |
| 5 | `search_files` | pattern, path, file_glob? | 50 results, 10s timeout | Grep-based content search |

### 3.5 Supported Models (via Poe API)

| # | Provider | Model Name | Type |
|---|----------|------------|------|
| 1 | Anthropic | Claude-Sonnet-4 | Chat + Tools |
| 2 | Anthropic | Claude-3.7-Sonnet | Chat + Tools |
| 3 | Anthropic | Claude-3-Haiku | Chat + Tools |
| 4 | OpenAI | GPT-4o | Chat + Tools |
| 5 | OpenAI | GPT-4.1 | Chat + Tools |
| 6 | OpenAI | GPT-4.1-mini | Chat + Tools |
| 7 | OpenAI | o3 | Reasoning |
| 8 | OpenAI | o4-mini | Reasoning |
| 9 | Google | Gemini-2.5-Pro | Chat + Tools |
| 10 | Google | Gemini-2.5-Flash | Chat |
| 11 | Google | Gemini-2.0-Flash | Chat |

### 3.6 System Control Layer (30/31 items)

| Domain | Items | Coverage |
|--------|-------|----------|
| Input Controls | Esc cancel, Ctrl+C exit, Ctrl+L clear, Up/Down history, Tab completion | 6/7 |
| Output Controls | Streaming, spinner, tokens, cost, tok/s, TTFT | 6/6 |
| Session Controls | /clear, /compact, /retry, exit summary, history persistence | 5/5 |
| Model Controls | /model show, /model set, /models picker, auto-detect | 4/4 |
| Error Handling | 6-class classification, hints, rate limit, graceful shutdown | 4/4 |
| Safety | Tool round limit (8), write confirm, cmd timeout (30s), read limit (300), truncation | 5/5 |

### 3.7 Configuration System

| Tier | Source | Format | Scope |
|------|--------|--------|-------|
| 1 (highest) | CLI flags | `--provider poe --model GPT-4o` | Runtime |
| 2 | Environment | `POE_API_KEY`, `ORCA_PROVIDER`, `ORCA_MODEL` | Process |
| 3 | Project | `.orca.json` | Per-directory |
| 4 (lowest) | Global | `~/.orca/config.json` | User-wide |

### 3.8 Cost Estimation (12 pricing tiers)

| Model Pattern | Input $/1M | Output $/1M |
|---------------|-----------|-------------|
| claude-opus | 15.00 | 75.00 |
| claude-sonnet | 3.00 | 15.00 |
| claude-haiku | 0.25 | 1.25 |
| gpt-4o | 2.50 | 10.00 |
| gpt-4.1 | 2.00 | 8.00 |
| gpt-4.1-mini | 0.40 | 1.60 |
| o3 | 10.00 | 40.00 |
| o4-mini | 1.10 | 4.40 |
| gemini-2.5-pro | 1.25 | 10.00 |
| gemini-2.5-flash | 0.15 | 0.60 |
| poe (fallback) | 3.00 | 15.00 |

---

## 4. Layer 3: OrcaOS (AI-OS)

### 4.1 Core Statistics

| Metric | Count |
|--------|-------|
| Skills | 112 directories |
| Core Python modules | 38 |
| Harness modules | 16 |
| Launcher start functions | 53 |
| Launcher total lines | 8,074 |

### 4.2 Launcher Integration Points

| Tool | Command | Launch Function |
|------|---------|----------------|
| Claude Code | `ai claude` or `ai` → `1` | `start_claude` |
| Claude via Gemini | `ai` → `1g` | `start_1g_claude_code_gemini` |
| Codex | `ai codex` or `ai` → `2` | `start_codex` |
| Codex via Poe | `ai` → `2p` | `start_codex_poe` |
| Gemini CLI | `ai gemini` or `ai` → `3` | `start_gemini` |
| Amp CLI | `ai amp` or `ai` → `4` | `start_amp` |
| Droid | `ai droid` or `ai` → `5` | `start_droid` |
| **Orca CLI** | **`ai orca` or `ai` → `6`** | **Inline (node dist/bin/orca.js)** |

### 4.3 Harness Engineering Layer (16 modules)

| Module | Purpose |
|--------|---------|
| `verification_gate.py` | Pre-completion check: lint + test + typecheck + PDCA |
| `loop_detector.py` | Track edits, auto-pivot after 2 failures (Tw93 rule) |
| `context_monitor.py` | Utilization: 40% warn / 50% compact / 60% clear |
| `trace_collector.py` | Structured execution traces → DNA capsule |
| `semantic_skill_router.py` | Route skills via semantic fabric |
| `knowledge_compounder.py` | Fix → pattern → embed → DNA capsule |
| `staleness_detector.py` | Detect stale refs + auto-fix |
| `structural_test.py` | ArchUnit-style dependency layer verification |
| `quality_scorer.py` | 5-dimension grading: lint/tests/docs/hygiene/structural |
| `auditor.py` | Full audit: health + staleness + knowledge |
| `health.py` | Unified health report + quality score |
| `token_budget.py` | Reasoning Sandwich: HIGH plan/verify, STANDARD build |
| `session_state.py` | Cross-session state persistence |
| `goal_loop.py` | Criteria-driven persistent loop |
| `goal_loop_cron.py` | Cron-scheduled goal loop execution |
| `__init__.py` | Package initialization |

### 4.4 Orca CLI Integration in AI-Fleet

```bash
# Direct command
ai orca chat -p poe -m GPT-4o "analyze this project"

# Interactive menu → 6
ai
> 6
启动 Orca CLI (Orca Agent SDK)...

# Inline from menu
> orca what is this project about?
```

Features:
- Auto proxy detection (reads macOS system proxy via `scutil --proxy`)
- Lazy build (compiles on first use if dist/ missing)
- `HTTPS_PROXY` auto-injection for Surge/Shadowrocket environments

---

## 5. Cross-Layer Capability Matrix

| Capability | SDK (L1) | CLI (L2) | AI-OS (L3) |
|-----------|----------|----------|------------|
| **Agent Loop** | Full engine (50+ tools) | 5-tool proxy agent loop | Delegates to L2 |
| **Multi-Provider** | Anthropic + OpenAI adapters | Poe (Claude+GPT+Gemini) | Routes to all CLI tools |
| **Streaming** | Async generator | Terminal streaming + TTFT | Pass-through |
| **Tool Calling** | Native (engine-managed) | OpenAI function calling | N/A |
| **Multi-Turn** | Session-scoped | ChatMessage[] history | N/A |
| **Multi-Agent** | Teams + subagents + coordinator | Single-agent (via proxy) | Agent Teams blueprint |
| **MCP** | Client (7 transports) + server contract | Not exposed (proxy path) | Skill integration |
| **Context Mgmt** | Token counting + 3 auto-compact modes | /compact (keep last 2) | Harness context_monitor |
| **Observability** | Trace bus + OTel (beta-gated) | tok/s + cost + TTFT + session summary | trace_collector |
| **Eval** | Trajectory + tool validation + golden | N/A | verification_gate |
| **Guardrails** | Input/output/tool pipeline | Write confirm + cmd timeout | loop_detector |
| **Checkpointing** | InMemoryCheckpointStore | N/A | session_state |
| **Memory** | 7-type MemoryStore | Input history file | knowledge_compounder |
| **Workflow** | State graph + HITL | N/A | goal_loop + SOP engine |
| **Skills** | SkillTool | N/A | 112 skills + semantic router |
| **Security** | 4-layer permission pipeline | DANGEROUS_TOOLS gate | Pre-tool-validate hook |
| **CI/CD** | GitHub Actions (Node 18/20/22) | Standalone (no CI yet) | N/A |

---

## 6. Data Flow

### 6.1 Poe Proxy Path (orca chat -p poe)

```
User Input
    │
    ▼
REPL (readline + history + Tab completion)
    │
    ▼
Config Resolver (flags > env > project > global)
    │
    ▼
Provider Router (auto-detect from model name)
    │
    ▼
OpenAI-Compatible API (Poe/OpenRouter)
    ├── messages[] (multi-turn history)
    ├── tools[] (5 function definitions)
    └── stream: true
    │
    ▼
Streaming Response
    ├── text delta → streamToken()
    ├── tool_calls → executeTool() → tool result → loop back
    └── done → usage summary (tokens, cost, tok/s)
    │
    ▼
History Update (user + assistant messages appended)
    │
    ▼
Next Prompt
```

### 6.2 SDK Native Path (orca chat --provider anthropic)

```
User Input
    │
    ▼
REPL → Config → Provider Router
    │
    ▼
@orca/sdk createAgent()
    │
    ▼
QueryEngine → styleRouter → providerSelection
    │
    ▼
Provider Bridge (14 seam modules)
    │
    ▼
Anthropic/OpenAI API
    │
    ▼
Stream → Tool Execution (50 built-in tools) → Loop
    │
    ▼
Result
```

---

## 7. Version History

| Date | Event | Impact |
|------|-------|--------|
| 2026-04-03 | SDK extracted from Claude Code engine | Phase 1-2 complete |
| 2026-04-03 | 5-way swarm audit: 14 SOTA gaps identified | Architecture direction |
| 2026-04-03 | SOTA Sprint 1-4: all 14 gaps closed | 170 tests, 12 contracts |
| 2026-04-03 | Renamed to Orca; repo: orca-agent-sdk | Brand established |
| 2026-04-04 | Orca CLI created (Sprint A-F) | REPL + tools + multi-model |
| 2026-04-04 | Poe API integration verified | Claude + GPT + Gemini E2E |
| 2026-04-04 | 3-round code audit passed | Security + arch + DX |
| 2026-04-04 | User journey E2E: 6 scenarios passed | All tools verified |
| 2026-04-04 | Tool registry: 51 tools verified | 3-round test suite |
| 2026-04-04 | Repo split: SDK / CLI / AI-OS | Clean architecture |

---

Maurice | maurice_wen@proton.me
