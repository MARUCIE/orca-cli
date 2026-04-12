# Changelog

This file is a historical release log. Version-specific counts and examples reflect the release date they were recorded, not the current repo head.

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
