# Changelog

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
- **`forge bench`** — 10 standardized coding scenarios, reports pass/fail + score
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
L0  Benchmark    forge bench (10 scenarios)
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
