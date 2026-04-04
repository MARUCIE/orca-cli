# Forge CLI — SOTA Agent Test Plan

> Goal: Transform Forge CLI from "feature-complete" to "SOTA programming agent"
> by systematically testing and hardening every dimension that separates
> a good coding agent from a great one.

## Executive Summary

Current state: 5,111 LOC, 41 tools, 8 hooks, 11 models, 262 tests (12 rounds).
All 10 SOTA dimensions covered + 3 hardening rounds (determinism, adversarial, protocol).

Key insight from research: **Model raw score vs agent delivery has a 20+ point gap**
(Claude Opus 80.9% SWE-bench vs Claude Code 58.0%). The gap = harness engineering.
Forge CLI wins by having the best harness, not the best model.

---

## 10 SOTA Evaluation Dimensions

| # | Dimension | Source | Current Coverage | Priority |
|---|-----------|--------|-----------------|----------|
| D1 | Tool Execution Accuracy | Aider | 87/129 tests | Covered |
| D2 | Edit Format Compliance | Aider Polyglot | 24/129 tests | Covered |
| D3 | Agent Loop Integrity | SWE-bench | 0 tests | **CRITICAL** |
| D4 | Multi-Model Collaboration | Forge-unique | 0 tests | **CRITICAL** |
| D5 | Hook System & Safety | Claude Code | 0 tests | **CRITICAL** |
| D6 | Complex Bug Fix | SWE-bench | 5 tests (basic) | **HIGH** |
| D7 | Feature Development | FeatureBench | 3 tests (basic) | **HIGH** |
| D8 | Large Codebase Awareness | SWE-bench Pro | 0 tests | **HIGH** |
| D9 | Error Recovery & Resilience | Production audit | 0 tests | **MEDIUM** |
| D10 | End-to-End Workflow | Terminal-Bench | 0 tests | **MEDIUM** |

---

## Test Architecture (9 Rounds)

### Existing Rounds (129 tests)

- **Round 1** (tools.test.ts): 20 tests — Core tool operations
- **Round 2** (tools-full.test.ts): 45 tests — All 41 tools exercised
- **Round 3** (integration.test.ts): 18 tests — 5 coding scenarios
- **Round 3b** (edge-cases.test.ts): 24 tests — Boundary conditions
- **Round 3c** (config/output/program): 22 tests — Config, output, CLI

### New Rounds (85+ tests)

#### Round 4: Agent Loop Integrity (agent-loop.test.ts) — 15 tests

Tests the streaming conversation loop that is the heart of any coding agent.

| Test | What It Proves | Dimension |
|------|---------------|-----------|
| 4.1 | streamChat yields text tokens | D3 |
| 4.2 | streamChat yields tool_call events | D3 |
| 4.3 | Auto-continue on finishReason='length' | D3 |
| 4.4 | Incomplete text detection triggers continue | D3 |
| 4.5 | Per-model max_tokens lookup | D3 |
| 4.6 | Stops on finishReason='stop' | D3 |
| 4.7 | Tool calls accumulate across chunks | D3 |
| 4.8 | Multiple tool calls in single response | D3 |
| 4.9 | Tool result fed back into next round | D3 |
| 4.10 | Context token tracking (chars/4) | D3 |
| 4.11 | Auto-compact at 60% threshold | D3/D9 |
| 4.12 | Graceful handling of API errors | D9 |
| 4.13 | Timeout recovery on stalled response | D9 |
| 4.14 | Empty response handling | D9 |
| 4.15 | Max output tokens per model family | D3 |

#### Round 5: Hook System & Safety (hooks.test.ts) — 15 tests

Tests the 8-event hook lifecycle that provides extensibility and safety.

| Test | What It Proves | Dimension |
|------|---------------|-----------|
| 5.1 | HookManager loads from .armature/hooks.json | D5 |
| 5.2 | HookManager loads from .armature.json | D5 |
| 5.3 | HookManager loads from .claude/hooks.json | D5 |
| 5.4 | PreToolUse hook receives tool name + input JSON | D5 |
| 5.5 | PreToolUse non-zero exit blocks tool execution | D5 |
| 5.6 | PostToolUse hook receives tool result | D5 |
| 5.7 | SessionStart hook fires on REPL init | D5 |
| 5.8 | SessionEnd hook fires on clean exit | D5 |
| 5.9 | PreSendMessage hook can modify prompt | D5 |
| 5.10 | PostSendMessage hook receives response | D5 |
| 5.11 | Error hook fires on tool failure | D5 |
| 5.12 | Notification hook fires on notify_user | D5 |
| 5.13 | Hook env vars: FORGE_HOOK_EVENT, FORGE_HOOK_TOOL, FORGE_CWD | D5 |
| 5.14 | DANGEROUS_TOOLS set has exactly 9 members | D5 |
| 5.15 | Safe mode blocks dangerous tools without permission | D5 |

#### Round 6: Complex Coding Scenarios (complex-scenarios.test.ts) — 20 tests

Simulates the hardest real-world coding challenges that differentiate agents.

**Scenario A: SWE-bench Style — Multi-File Bug Fix (5 tests)**
- Setup: Express app with auth bug (token validation in middleware.ts checks wrong field,
  symptom appears in routes/user.ts as 403)
- Agent must: trace symptom → find root cause in different file → fix → verify

**Scenario B: FeatureBench Style — Feature From Scratch (5 tests)**
- Setup: Bare Express app with user CRUD
- Agent must: add pagination to list endpoint + update types + add tests + update docs

**Scenario C: Cross-Module Refactor (5 tests)**
- Setup: 5-file module with tight coupling
- Agent must: extract shared interface, update all importers, verify no breakage

**Scenario D: Second-Chance Fix (5 tests)**
- Setup: Code with a subtle off-by-one error
- Round 1: Agent fixes (may or may not succeed)
- Round 2: Agent sees test failure output, must fix based on error message
- Tests the "Aider two-chance" pattern

#### Round 7: Large Codebase Stress (large-codebase.test.ts) — 12 tests

Tests accuracy when navigating 50+ file projects.

| Test | What It Proves | Dimension |
|------|---------------|-----------|
| 7.1 | glob_files finds across 50+ files | D8 |
| 7.2 | search_files finds across 50+ files | D8 |
| 7.3 | find_definition accurate in large project | D8 |
| 7.4 | find_references comprehensive in large project | D8 |
| 7.5 | directory_tree handles deep nesting (10 levels) | D8 |
| 7.6 | count_lines accurate on 50+ files | D8 |
| 7.7 | edit_file precise in file with 500+ lines | D8 |
| 7.8 | search_files with regex in large corpus | D8 |
| 7.9 | multi_edit batch on 500+ line file | D8 |
| 7.10 | list_directory recursive on wide tree | D8 |
| 7.11 | Cross-directory file discovery | D8 |
| 7.12 | Performance: tools complete in <2s on large project | D8 |

#### Round 8: E2E Workflow & Rendering (e2e-workflow.test.ts) — 12 tests

Tests the full agent experience: markdown rendering, output formatting, session management.

| Test | What It Proves | Dimension |
|------|---------------|-----------|
| 8.1 | StreamMarkdown renders headings | D10 |
| 8.2 | StreamMarkdown renders code blocks with borders | D10 |
| 8.3 | StreamMarkdown renders inline formatting (**bold**, `code`) | D10 |
| 8.4 | Code highlighting: JS/TS keywords colored | D10 |
| 8.5 | Code highlighting: Python keywords colored | D10 |
| 8.6 | Code highlighting: Shell variables colored | D10 |
| 8.7 | Code highlighting: JSON keys/values colored | D10 |
| 8.8 | System prompt includes all 41 tools | D10 |
| 8.9 | System prompt tool signatures match definitions | D10 |
| 8.10 | Full workflow: create plan → execute → verify | D10 |
| 8.11 | Batch renderMarkdown for post-hoc use | D10 |
| 8.12 | hasMarkdown detection accuracy | D10 |

#### Round 9: Multi-Model Collaboration (multi-model.test.ts) — 11 tests

Tests Forge CLI's unique multi-model feature.

| Test | What It Proves | Dimension |
|------|---------------|-----------|
| 9.1 | pickDiverseModels returns models from different vendors | D4 |
| 9.2 | pickDiverseModels covers max vendor diversity | D4 |
| 9.3 | buildJudgePrompt includes all model responses | D4 |
| 9.4 | buildJudgePrompt instructs synthesis | D4 |
| 9.5 | Council flow: parallel query + judge synthesis | D4 |
| 9.6 | Race flow: first response wins | D4 |
| 9.7 | Pipeline flow: plan → code → review chain | D4 |
| 9.8 | Pipeline 5-stage: plan → code → review → fix → verify | D4 |
| 9.9 | Model name validation | D4 |
| 9.10 | Error handling: model timeout in council | D4 |
| 9.11 | Error handling: all models fail in race | D4 |

---

## SOTA Quality Gate

A Forge CLI release is SOTA-ready when ALL of the following pass:

1. **Tool Accuracy**: 41/41 tools functional, edit precision >99%
2. **Agent Loop**: Auto-continue works, context management active
3. **Multi-Model**: Council/Race/Pipeline all functional
4. **Hook System**: All 8 events fire, PreToolUse blocking works
5. **Complex Scenarios**: Multi-file bug fix + feature dev + refactor all pass
6. **Large Codebase**: All tools accurate on 50+ file project
7. **E2E Workflow**: Full understand→plan→code→test→commit loop works
8. **Safety**: Dangerous tools blocked in safe mode, no secret leakage
9. **Error Recovery**: Graceful degradation on API errors/timeouts
10. **Test Coverage**: 210+ tests, all green

---

## 7 Agent Failure Modes (Detection Tests)

From production audit research, each mode has dedicated test coverage:

| Failure Mode | Risk | Detection Test |
|-------------|------|---------------|
| Silent failure (code runs but logic wrong) | CRITICAL | Scenario D: second-chance fix |
| Business logic mismatch | HIGH | Scenario A: symptom vs root cause |
| Large codebase degradation | HIGH | Round 7: 50+ file accuracy |
| Error suppression | MEDIUM | Round 4: error recovery |
| Cascade errors | MEDIUM | Scenario C: refactor chain |
| Team integration failure | LOW | Round 8: git commit + verify |
| Security vulnerabilities | LOW | Round 5: permission system |

---

## Execution Schedule

| Round | File | Tests | Status |
|-------|------|-------|--------|
| 1 | tools.test.ts | 20 | DONE |
| 2 | tools-full.test.ts | 45 | DONE |
| 3 | integration.test.ts | 18 | DONE |
| 3b | edge-cases.test.ts | 24 | DONE |
| 3c | config/output/program | 22 | DONE |
| 4 | agent-loop.test.ts | 15 | DONE |
| 5 | hooks.test.ts | 15 | DONE |
| 6 | complex-scenarios.test.ts | 20 | DONE |
| 7 | large-codebase.test.ts | 12 | DONE |
| 8 | e2e-workflow.test.ts | 12 | DONE |
| 9 | multi-model.test.ts | 11 | DONE |
| 10 | determinism.test.ts | 15 | DONE |
| 11 | adversarial.test.ts | 18 | DONE |
| 12 | protocol.test.ts | 15 | DONE |
| **Total** | | **262** | |

---

Maurice | maurice_wen@proton.me
