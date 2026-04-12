# Changelog

This file is a historical release log. Version-specific counts and examples reflect the release date they were recorded, not the current repo head.

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
