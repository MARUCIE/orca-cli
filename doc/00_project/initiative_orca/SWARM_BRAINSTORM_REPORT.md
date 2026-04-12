# Orca Ecosystem SOTA Gap Analysis — Swarm Brainstorming Report

> v0.3.0 baseline | 2026-04-12 | 3-agent parallel research synthesis

## Executive Summary

Orca CLI v0.3.0 has a solid foundation (41 tools, 10 hook events, multi-model council/race/pipeline, 464 tests). But compared to SOTA coding agents (Claude Code, Codex CLI, Amp CLI, KiloCode, Hermes), Orca has **critical gaps in 6 dimensions** that prevent it from being a genuine SOTA-level CLI.

The good news: AI-Fleet already has mature implementations for most of these gaps. The transplant path is clear.

---

## Current State: Orca v0.3.0 (Honest Assessment)

**Overall maturity: 70-75% production-ready** (per deep code audit)

| Dimension | Claimed | Actual | Maturity |
|---|---|---|---|
| Tool System | 41 tools | 35 fully implemented, 3 async stubs, 3 partial | 75% |
| Multi-Model | Council/Race/Pipeline | Council works, Race/Pipeline incomplete | 75% |
| Hooks | 10 events | 8 implemented, SubagentStop+Stop missing in code | 80% |
| MCP Client | Full client | Production-ready, no server hosting | 90% |
| Context Mgmt | Project detection + budget | Solid detection, weak window estimation | 80% |
| Session | Save/Load/Resume | Save only, NO resume implementation | 50% |
| Security | shellEscape + safe mode | Binary safe/yolo, no OS sandbox | 60% |
| Agent Loop | Unlimited auto-continue | Sequential only, no sub-agent spawning | 70% |
| Observability | Logs + doctor + stats | Minimal instrumentation, no tracing | 40% |
| Testing | 464 tests / 35 files | Verified: all pass | 95% |

### Key Gaps Revealed by Audit

1. **spawn_agent / delegate_task**: Defined in TOOL_DEFINITIONS but are async stubs — no actual process spawning
2. **Session resume**: Sessions save to disk but `orca -c` (continue) is not wired up
3. **Race cancellation**: CancelRequest not implemented — losing models complete anyway
4. **Pipeline stages**: Partially implemented, not all 5 stages functional
5. **Hook events**: README claims SubagentStop and Stop but code only has 8 events
6. **Effort flag**: `--effort` defined in CLI but not wired to model-specific prompts
7. **PR command**: Defined but minimal 3.8K stub
8. **Cost tracking**: usage_db stores cost_usd but always receives 0

---

## 6 Critical Gap Dimensions

### Gap 1: Harness Engineering Layer (from AI-Fleet)

**What Orca lacks**: The entire 18-module harness layer that AI-Fleet has built.

| AI-Fleet Module | Purpose | Transplant Priority |
|---|---|---|
| `verification_gate.py` | Pre-completion check (lint/test/typecheck) | P0 - CRITICAL |
| `loop_detector.py` | Detect repeated failures, auto-pivot | P0 - CRITICAL |
| `context_monitor.py` | 4-tier utilization alerts (40/50/60%) | P0 - CRITICAL |
| `trace_collector.py` | Structured execution traces | P1 - HIGH |
| `quality_scorer.py` | 5-dimension quality grading (A-F) | P1 - HIGH |
| `staleness_detector.py` | Detect stale refs + auto-fix | P1 - HIGH |
| `knowledge_compounder.py` | Fix -> pattern -> DNA capsule | P2 - MEDIUM |
| `semantic_skill_router.py` | Progressive disclosure routing | P2 - MEDIUM |
| `session_state.py` | Cross-session persistence | P2 - MEDIUM |
| `token_budget.py` | Reasoning Sandwich (HIGH plan, STD build) | P1 - HIGH |
| `goal_loop.py` | Criteria-driven persistent loop | P2 - MEDIUM |
| `structural_test.py` | ArchUnit-style layer verification | P3 - LOW |
| `auditor.py` | Full audit: health + staleness | P2 - MEDIUM |
| `health.py` | Unified health report | P1 - HIGH |
| `error_classifier.py` | Classify errors for recovery | P1 - HIGH |
| `cognitive_router.py` | Cognitive model routing | P2 - MEDIUM |
| `browser_self_repair.py` | Browser automation recovery | P3 - LOW |
| `goal_loop_cron.py` | Scheduled goal loops | P3 - LOW |

**Transplant effort**: TS rewrite of P0+P1 modules = ~8 files, ~2000 LOC
**Impact**: Closes the "harness gap" (the 20-point delta between model capability and agent delivery)

### Gap 2: Agent Isolation & Multi-Agent (from Claude Code)

**What Orca lacks**: Sub-agent spawning with isolated context, git worktree-based agent teams.

| Feature | Claude Code Has | Orca Has | Gap |
|---|---|---|---|
| Sub-agent spawn | Haiku exploration agents | `spawn_agent` tool (stub) | Needs real isolation |
| Worktree isolation | `--worktree` per agent | None | Missing entirely |
| Agent teams | Lead + N workers | None | Missing entirely |
| Context isolation | Each agent has own window | Shared context | Missing |
| Cheap delegation | Haiku for search, Opus for think | Single model | Missing |

**Transplant path**: Implement git worktree spawning + process isolation for sub-agents
**Effort**: ~1500 LOC new module
**Impact**: Enables parallel work without context pollution

### Gap 3: Security Sandbox (from Codex CLI)

**What Orca lacks**: OS-enforced execution isolation.

| Feature | Codex Has | Orca Has | Gap |
|---|---|---|---|
| macOS Seatbelt | sandbox-exec profiles | None | Critical for production |
| Linux Landlock | Kernel-level FS isolation | None | Critical for CI |
| Network policy | Proxy-only egress | Open network | Security risk |
| File approval | Per-directory permissions | Binary safe/yolo | Too coarse |

**Transplant path**: Seatbelt profile generation for macOS, bwrap for Linux
**Effort**: ~800 LOC new module
**Impact**: Makes Orca safe for untrusted code execution

### Gap 4: Skills System (from AI-Fleet + Hermes)

**What Orca lacks**: A composable skill system with execution modes.

| Feature | AI-Fleet Has | Hermes Has | Orca Has | Gap |
|---|---|---|---|---|
| Skill registry | skill-groups.json (28 groups) | 123 skills | Context loading only | No execution engine |
| Execution modes | swarm/pipeline/loop/sequential | Single-shot | None | Missing entirely |
| Skill routing | Semantic + trigger-based | Category-based | None | Missing |
| Core/Extended tiers | coreTier + extendedTier | core + optional | None | Missing |
| Skill marketplace | Internal registry | Community hub | None | Missing |

**Transplant path**: Port skill-groups.json structure + execution engine from AI-Fleet
**Effort**: ~1200 LOC new module
**Impact**: Enables composable, reusable agent behaviors

### Gap 5: Platform Gateway (from Hermes)

**What Orca lacks**: Multi-channel reach beyond CLI.

| Channel | Hermes Has | Orca Has |
|---|---|---|
| CLI | Yes | Yes |
| HTTP server | Yes | Yes (orca serve) |
| Telegram | Yes | No |
| Discord | Yes | No |
| Slack | Yes | No |
| Webhook receiver | Yes | No |
| iMessage | Yes | No |

**Transplant path**: Webhook ingress + platform adapters
**Effort**: ~600 LOC per channel
**Impact**: Extends Orca from CLI tool to platform agent

### Gap 6: Persistent Memory & Learning (from OpenClaw + AI-Fleet)

**What Orca lacks**: Cross-session learning and knowledge compounding.

| Feature | AI-Fleet Has | OpenClaw Has | Orca Has |
|---|---|---|---|
| DNA capsules | dna-registry.json | Self-improving agent | None |
| Knowledge compounding | Fix -> pattern -> capsule | Memory management | None |
| Cross-session state | session_state.py | Thread management | Session save/load only |
| Cognitive reflection | Promotion cycle | Self-reflection | None |
| MemPalace | ChromaDB + SQLite | Semantic search | None |

**Transplant path**: Port knowledge_compounder + DNA inheritance
**Effort**: ~1000 LOC
**Impact**: Orca learns from its own mistakes across sessions

---

## Priority Matrix

| Priority | Gap | Effort | Impact | ROI |
|---|---|---|---|---|
| P0 | Harness Layer (verification + loop detect + context monitor) | 2000 LOC | Closes 20-point model-agent gap | HIGHEST |
| P0 | Agent Isolation (sub-agents + worktree) | 1500 LOC | Enables parallel work | HIGHEST |
| P1 | Skills System (registry + execution engine) | 1200 LOC | Composable behaviors | HIGH |
| P1 | Security Sandbox (Seatbelt + bwrap) | 800 LOC | Production safety | HIGH |
| P2 | Persistent Memory (DNA + knowledge compound) | 1000 LOC | Cross-session learning | MEDIUM |
| P3 | Platform Gateway (Telegram + Discord + Webhook) | 1800 LOC | Multi-channel reach | MEDIUM |

---

## Three-Tier Architecture Mapping

| Tier | Component | Current | Target |
|---|---|---|---|
| **L1: Orca Agent SDK** | Core agent runtime | Tool system + streaming | + Harness + Isolation + Sandbox |
| **L2: Orca CLI** | User-facing CLI | 41 tools, 10 hooks | + Skills engine + Mode system + Agent teams |
| **L3: OrcaOS** | Platform layer | orca serve (basic) | + Gateway + Webhook + Channel adapters |

---

## Competitive Positioning After Transplant

| Dimension | Current Leader | Orca After Transplant |
|---|---|---|
| Multi-model collaboration | Orca (unique) | Still leads — no competitor has council/race/pipeline |
| Agent isolation | Claude Code | Parity (worktree + sub-agent) |
| Security sandbox | Codex CLI | Parity (Seatbelt + bwrap) |
| Harness engineering | AI-Fleet (internal) | Leads — AI-Fleet harness is unique in open source |
| Skills ecosystem | KiloCode | Competitive (28 group registry from AI-Fleet) |
| Platform reach | Hermes | Competitive (CLI + HTTP + webhook + 2 channels) |
| Testing rigor | Orca (464 tests) | Leads — most tested open-source agent CLI |

---

## Recommended Execution Order

### Phase 1: Foundation (v0.4.0)
1. Harness: verification_gate + loop_detector + context_monitor (TS rewrite)
2. Harness: error_classifier + health reporter
3. Agent: sub-agent spawning with process isolation
4. Tests: Round 18-19 for harness modules

### Phase 2: Power (v0.5.0)
1. Skills: execution engine (swarm/pipeline/loop modes)
2. Skills: skill-groups.json registry loading
3. Security: Seatbelt sandbox for macOS
4. Agent: git worktree isolation for agent teams
5. Tests: Round 20-21 for skills + sandbox

### Phase 3: Platform (v0.6.0)
1. Gateway: webhook receiver
2. Gateway: Telegram adapter
3. Memory: DNA capsule system
4. Memory: knowledge compounding
5. Tests: Round 22-23 for gateway + memory

---

## Sources

- AI-Fleet core/harness/ (18 modules, ~196K)
- AI-Fleet configs/skill-groups.json (28 skill groups, 4 execution modes)
- AI-Fleet configs/dna-registry.json (DNA capsule system)
- Hermes Agent (123 skills, 15+ platform channels)
- Claude Code (Agent Teams, MCP lazy-loading, worktree isolation)
- Codex CLI (OS-enforced sandbox, network policies)
- Amp CLI (thread-based memory, AGENTS.md auto-discovery)
- KiloCode (mode system, diff editing, MCP marketplace)

---

Maurice | maurice_wen@proton.me
