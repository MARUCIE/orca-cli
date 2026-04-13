# Changelog

This file is a historical release log. Version-specific counts and examples reflect the release date they were recorded, not the current repo head.

## v0.7.1 — Knowledge Management + Goal-Loop Execution (2026-04-13)

AI-Fleet documentation management system transplant + long task delivery.

### Knowledge Management System (4 modules)
- **NotesManager**: `/notes [list|add|search]` — tagged observations with keyword search
- **PostmortemLog**: `/postmortem [list|search]` — structured error patterns with auto-matching
- **PromptRepository**: `/prompts [list|find]` — versioned templates with usage/success tracking
- **LearningJournal**: `/learn [rules|observe|status]` — auto-evolution: observation → promotion cycle

### Context Guard (mandatory PostToolUse hook)
- Fires after every tool use, auto-compacts at 60% utilization
- Three-layer protection: PostToolUse 60% → Pre-Send 75% → 413 recovery

### Goal-Loop Execution
- `orca run --done-when` now calls LLM via chatOnce per iteration
- Criteria: "tests pass" / "/regex/" / "exit 0: cmd" / "typecheck passes"

Tests: 732 pass / 47 files.

## v0.6.2 — Output Intelligence + Cognitive Skeleton (2026-04-13)

6 fixes from screenshot-based I/O analysis:

### Critical Fix
- **Context display overflow**: chars/4 fallback capped at contextWindow (was showing 3.0M/200K = 1500%)
- **CJK token estimation**: Latin ~4 chars/tok, CJK ~1.5 chars/tok (was treating all text as Latin)

### StatusLine Enhancements
- **Cost display**: estimated session cost in statusline ($0.42 format)
- **tok/s**: output speed metric from latest turn
- **Input/output split**: `in:1.2M out:234K` alongside total
- **Overflow indicator**: `!` mark when context >= 95%

### Progress Indicator
- **"esc to interrupt"** reduced to "esc" after 5 seconds (was repeating full hint every 100ms)
- **CJK-aware addText()**: replaces addChars() in streaming callback

### Harness Warnings
- Show actual token counts: `context 42.0% YELLOW (84K/200K) -- run /compact`
- More actionable: "run /clear now" instead of "recommended"

### Cognitive Skeleton (new module)
- 9 scenarios x 4 mental models (111 Munger + 100 PM frameworks)
- Auto-matches user prompt → injects relevant thinking models as context
- First Principles pre-check injected into system prompt (always-on)
- Chinese trigger support (CJK regex without \\b word boundary)

Tests: 688 pass / 45 files (+20 new tests).

## v0.7.0 — Multi-Model Routing + Context Guard (2026-04-13)

Core differentiator features for multi-model collaboration.

### Multi-Model Routing Fix (P0)
- **`findAggregator()` auto-detects Poe/OpenRouter**: no longer requires `aggregator: true` in config
- **All DIVERSITY_GROUPS models route through aggregator**: council/race/pipeline now actually call diverse models
- **Pre-flight endpoint check**: /council and /race verify endpoints exist before calling, show diagnostics on failure
- **Routing visibility**: council shows "model → provider" mapping before execution

### Pre-Send Context Guard (P0)
- **Budget check before API call**: auto-compact when history > 75% of context window
- **Aggressive smartCompact**: drops ALL older messages (was keeping "decision" messages that blocked compaction)
- **Large message truncation**: messages > 2000 chars truncated in compaction
- **413 auto-recovery**: catches context_length_exceeded, auto-compacts, allows retry

### SOTA Gap Document Updated
- v0.7.0 gap re-assessment with 4 focus areas
- Root cause analysis of /council routing failure
- Implementation plan for sub-agent agentic loop (P1) and goal-loop (P2)

Tests: 692 pass / 45 files (+4 new config routing tests).

## v0.6.2 — Output Intelligence + Cognitive Skeleton (2026-04-13)

Three rounds of UX improvements based on 2-agent swarm audit
(internal deep audit + competitor analysis: Claude Code/Codex/Amp/Aider/Cursor).

### UX Round 1 — Core Feedback
- **Progress indicator**: chars/4 token estimation (was text.length), distinct Working spinner (◐◓◑◒)
- **Tool display**: ms precision for sub-second (<1s shows "120ms"), error results in yellow
- **StatusLine**: dot separator (·), cleaner effort tags, ANSI-aware right-alignment
- **Banner**: 20 frames (was 54, ~1.2s vs ~4s), `ORCA_NO_ANIMATION=1` skip, cursor restore safety
- **Cost**: model-based pricing in /cost, serve, run (was hardcoded or $0)
- **Context monitor**: uses last API inputTokens (was cumulative), consistent with statusline
- **MCP**: /mcp enable/disable per-server toggle

### UX Round 2 — SOTA Feature Parity
- **Inline diff**: edit_file results show colored +/- diff with folding (>12 lines)
- **Shell mode**: `!command` direct execution from prompt (like Amp's $ prefix)
- **Tool folding**: run_command shows first line + "(N lines)" for long output

### UX Round 3 — Polish
- **Color themes**: `ORCA_THEME` env var with 5 presets (default/dark/ocean/warm/mono)
- **/help**: dual-column layout ~20 lines (was 60+), includes !cmd and /thread
- **Theme-aware**: statusline, banner, prompt icon use theme accent colors

### Fixes
- Background job test isolation via ORCA_HOME (no more ~/.orca/ pollution)
- TokenBudgetManager prefers API-reported inputTokens over chars/4 estimate
- /cost uses actual model pricing table (was $3/$15 hardcoded)
- serve.ts/run.ts compute costUsd from pricing (was always 0)
- write_file/edit_file preview truncated to 80 chars (was unbounded)

---

## v0.6.0 — Mode Wiring + Guidance Injection + Thread Memory (2026-04-13)

Completes full integration: /mode slash command, AGENTS.md guidance in system prompt,
thread-based conversation persistence. 1 new module, 3 REPL integrations, 28 new tests.

### /mode Slash Command (REPL Integration)
- `/mode` lists all modes + shows active
- `/mode <id>` switches mode, injects systemPromptPrefix into system prompt
- Mode tool restrictions displayed on switch
- Custom modes loaded from `.orca/modes.json` at startup

### Guidance Auto-Injection (System Prompt)
- `discoverGuidance()` called in `buildSystemPrompt()` — automatic, zero config
- Scans cwd + 3 parent dirs for AGENTS.md, CLAUDE.md, CODEX.md, .orca/rules/*.md
- Discovered guidance appended to system prompt with truncation (2000 chars/file)

### Thread-based Memory (Conversation Persistence)
- **ThreadManager** — create/list/load/append/search/delete threads
- Threads saved as JSON in `~/.orca/threads/`
- `/thread` slash command: list, save, load, search, delete subcommands
- Keyword search across thread titles and message content

### Test Coverage
- 44 test files, 668 tests (28 new for v0.6.0)
- All pass: 0 failures, 0 errors

---

## v0.5.0 — MCP Server + Mode System + AGENTS.md Discovery (2026-04-12)

Completes v0.5.0 scope: Orca as both MCP client AND server, behavioral mode system,
and hierarchical guidance discovery. 3 new source modules, 42 new tests.

### MCP Server Hosting
- **MCPServer** — stdio-based JSON-RPC 2.0 server exposing all Orca tools
- `orca serve --mcp` starts MCP mode over stdio (initialize, tools/list, tools/call)
- Full error handling: -32700 (parse error), -32601 (method not found)
- Notifications (no id) handled silently per MCP spec

### Mode System (Behavioral Profiles)
- **ModeRegistry** — 5 builtin modes: default, code-review, debug, architect, docs
- Each mode bundles: systemPromptPrefix, tool whitelist, instructions
- `loadFromFile()` for custom modes from .orca/modes.json
- Modes shape agent behavior without changing the underlying model

### AGENTS.md Auto-Discovery
- **discoverGuidance()** — scans cwd + parent dirs for AGENTS.md, CLAUDE.md, CODEX.md, .orca/rules/*.md
- **formatGuidanceForPrompt()** — formats discovered files into system prompt with truncation
- Depth-first ordering: closest files appear first
- Configurable maxDepth (default 3) and maxCharsPerFile (default 2000)

### Test Coverage
- 43 test files, 640 tests (42 new for v0.5.0 modules)
- All pass: 0 failures, 0 errors

---

## v0.4.0 — SOTA Gap Closure (2026-04-12)

Complete closure of all 6 SOTA gap dimensions identified by 3-agent parallel research.
15 new source modules, 105 new tests.

### Harness Engineering Layer (Phase 1)
- **Verification Gate** — pre-completion lint/typecheck/test gate with remediation hints
- **Loop Detector** — Tw93 rule: 2 failures → pivot, 3+ → escalate
- **Context Monitor** — 4-tier risk alerts (green/yellow/orange/red at 40/50/60%)
- **Error Classifier** — 9 error categories with retryable detection + recovery suggestions
- Wired into agent loop: risk warnings, error hints, pivot injection

### Agent Isolation (Phase 1)
- **Sub-agent process isolation** — fork child process with restricted tool whitelist
- **Git worktree teams** — WorktreeManager: create/merge/cleanup per-agent branches
- **Session resume** — `-c/--continue` loads most recent saved session
- **Effort flag** — `--effort low/medium/high/max` tunes system prompt
- **Cost tracking** — computes from model pricing table (was always $0)

### Skills Engine (Phase 2)
- **SkillRegistry** — loads skill-groups.json, trigger-based routing
- **SkillEngine** — 4 execution modes: swarm, pipeline, loop, sequential

### Security Sandbox (Phase 2)
- **macOS Seatbelt** — profile generation + sandbox-exec execution
- **Linux bubblewrap** — bwrap command with --unshare-net isolation
- **Platform detection** — unified executeSandboxed() with fallback

### Platform Gateway (Phase 3)
- **WebhookGateway** — HMAC-SHA256 validated HTTP endpoint with routing
- **TelegramAdapter** — long-polling bot with sendMessage

### Persistent Memory (Phase 3)
- **DNARegistry** — load/search/inherit/solidify knowledge capsules
- **KnowledgeCompounder** — fix → pattern → capsule promotion with dedup

### Stats
- 52 source files, ~10,300 LOC (was 37 files, ~7,200 LOC)
- 42 test files, 598 tests (was 35 files, 464 tests)
- 10 benchmark scenarios, Score: 100%
- TypeScript: 0 errors

---

## v0.3.0 — Orca Brand + SOTA Hardening (2026-04-12)

Complete brand rename from Armature/Forge to Orca. Animated orca ASCII art, dynamic hook display, and 38 new tests.

### Brand Rename
- **Armature SDK → Orca Agent SDK** (orca-agent-sdk)
- **Forge CLI → Orca CLI** (orca-cli), global `orca` command
- **AI-Fleet → OrcaOS** (L3 brand tier)
- All source, tests, docs, config paths, and launcher updated
- New GitHub repo: MARUCIE/orca-cli

### Animated Orca Banner
- Unicode block character killer whale silhouette (dorsal fin, eye patch, belly, tail flukes)
- Right-to-left swimming animation with body-wave undulation (per-line phase-shifted sine)
- Damped ease-out drift, 54+8 frames at 75ms

### Hook Banner Fix
- Fixed conflicting "8 hooks" (static) vs "51 hooks" (dynamic) display
- Banner now shows actual registered hook count from HookManager
- printStatus() outputs per-event breakdown without repeating the total

### SOTA Test Expansion (426 → 464, +38 tests)
- **Round 16** (v030-harness.test.ts, 20 tests): version consistency, shell injection protection, tool argument coercion (boolean/array/object), hook banner regression, doctor extended, brand identity
- **Round 17** (v030-coverage.test.ts, 18 tests): usage-db SQLite (6 tests), config-diagnostics (6 tests), session management (3 tests), init command (3 tests)
- Previously untested modules now covered: usage-db.ts, config-diagnostics.ts

### Stats
- 37 source files, ~7,200 LOC
- 35 test files, 464 tests
- 10 benchmark scenarios, Score: 100%
- TypeScript: 0 errors

---

## v0.1.0 — SOTA Programming Agent (2026-04-05)

First release. Provider-neutral coding agent CLI with multi-model collaboration,
self-evaluation benchmark, and 7-layer SOTA capability stack.

### Agent Core
- **41 tools** — file I/O, search, git, execution, planning, MCP, sub-agents
- **Unlimited agent loop** — auto-continue on truncation, incomplete text detection
- **Per-model max_tokens** — Claude 64K, GPT 64K, Gemini 65K, o3 100K
- **OpenAI-compatible provider** — works with any proxy (Poe, OpenRouter)
- **HTTP proxy support** — undici ProxyAgent for corporate/VPN environments

### Multi-Model Collaboration (Unique Feature)
- **Council** — N models answer in parallel, judge synthesizes best answer
- **Race** — N models race, first good answer wins, rest cancelled
- **Pipeline** — chain models as specialists: plan → code → review → fix → verify
- **11 models from 9 vendors** via single Poe API key

### SOTA Agent Capabilities
- **Project context loader** — auto-detect type, framework, test runner, deps, git
- **Smart output truncation** — 8K limit with summary header (line count + file list)
- **Error self-correction hints** — failed tools suggest recovery actions
- **Auto-verify** — tsc/eslint/cargo check/go vet after file modifications
- **Token budget manager** — per-model context windows, 4-tier risk levels
- **Smart compaction** — preserves decision-bearing messages, drops verbose text
- **Retry intelligence** — 2 failures of same tool+args → inject recovery hint

### Security
- **shellEscape()** on all user inputs before shell execution
- **Negative index rejection** in notebook_edit
- **Boundary protection** in read_file (start_line clamped to >= 0)
- **9 dangerous tools** require confirmation in --safe mode
- **8 lifecycle hooks** — PreToolUse can block operations (exit 1)

### Developer Experience
- **Streaming markdown** — code blocks with box-drawing borders + syntax highlighting
- **Interactive REPL** — multi-line input, 25 slash commands, session persistence
- **Status line** — model, context %, git branch, thinking effort, token count
- **Command picker** — type `/` for interactive arrow-key selection
- **YOLO mode default** — auto-approve all tools, --safe for permission prompts

### Self-Evaluation
- **`orca bench`** — 10 standardized coding scenarios, reports pass/fail + score
- **326 automated tests** across 20 files, 16 rounds
- **CI pipeline** — GitHub Actions, Node 20+22 matrix, bench as quality gate

### Benchmark Scenarios (10)
| ID | Task | Category | Difficulty |
|----|------|----------|-----------|
| S1 | SQL injection fix | bug-fix | easy |
| S2 | Add pagination | feature-dev | medium |
| S3 | Extract interface | refactor | medium |
| S4 | Off-by-one fix | bug-fix | easy |
| S5 | Large project navigation | navigation | hard |
| S6 | Secret removal | bug-fix | easy |
| S7 | Error handling | feature-dev | medium |
| S8 | Multi-file rename | refactor | hard |
| S9 | New module creation | feature-dev | medium |
| S10 | Plan + verify | multi-step | hard |

### Architecture
```
L0  Benchmark    orca bench (10 scenarios)
L1  Tools        41 tools + shellEscape
L2  Context      Project auto-detection
L3  Intelligence Auto-verify + Retry + Error hints
L4  Budget       Token tracking + Smart compaction
L5  Multi-model  Council / Race / Pipeline
L6  Security     Shell protection + Hook permissions
```

### Stats
- 25 source files, ~8,200 LOC
- 20 test files, 326 tests
- 10 benchmark scenarios, Score: 100%
- 8 CLI commands, 25 slash commands
- 41 tools, 8 hooks, 11 models

---

Maurice | maurice_wen@proton.me
