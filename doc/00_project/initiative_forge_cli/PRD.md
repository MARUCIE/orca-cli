# Forge CLI PRD

## Product Snapshot

- Product: Forge CLI
- Package: `@armature/forge-cli`
- Domain: provider-neutral coding-agent CLI
- Primary users: developers who need coding-agent workflows across multiple model vendors
- Current repo status: active TypeScript CLI with runtime, multi-model collaboration, session management, PR review, serve mode, benchmark tooling, and Hermes-inspired runtime ergonomics

## Problem

Single-vendor coding CLIs force users into one model family per session. Forge CLI exists to give developers a single terminal-native workflow that can route across providers, run agent tasks, and coordinate multiple models when that meaningfully improves quality or speed.

## Goals

1. Provide a production-grade CLI for coding-agent usage with predictable provider/model routing.
2. Support multi-model collaboration modes that no single-vendor CLI can offer.
3. Preserve strong developer ergonomics: REPL, one-shot execution, saved sessions, PR review, stats, and headless serving.
4. Keep runtime behavior testable and inspectable through a large automated suite.

## Non-Goals

- Browser-first UX
- Backward-compatibility shims for outdated command or config formats
- Mock-only validation in place of real CLI/runtime verification

## Key User Jobs

| User Job | Current Surface | Source |
| --- | --- | --- |
| Ask the agent a question interactively | `forge chat`, default no-subcommand entry | `src/commands/chat.ts`, `src/program.ts` |
| Execute a coding task | `forge run` | `src/commands/run.ts` |
| Compare or combine models | `forge council`, `forge race`, `forge pipeline` | `src/commands/multi.ts`, `src/multi-model.ts` |
| Inspect providers and routing | `forge providers` | `src/commands/providers.ts` |
| Review saved state and cost | `forge session`, `forge stats` | `src/commands/session.ts`, `src/commands/stats.ts` |
| Track detached work | `run_background`, `/jobs` | `src/tools.ts`, `src/background-jobs.ts`, `src/commands/chat.ts` |
| Review pull requests | `forge pr` | `src/commands/pr.ts` |
| Expose a headless agent server | `forge serve` | `src/commands/serve.ts` |
| Benchmark the runtime | `forge bench` | `src/commands/bench.ts` |

## Core Capabilities

- Provider-neutral config and endpoint resolution
- OpenAI-compatible transport bridge
- Agent tool loop and runtime orchestration
- Multi-model council, race, and pipeline execution
- Hook loading and lifecycle execution
- Session persistence and usage tracking
- CLI output rendering and markdown streaming
- Tool argument coercion for model-emitted string values
- Oversized tool result persistence with artifact paths
- Background job tracking with completion notifications
- Provider-aware model catalog with context/pricing/caution metadata
- Provider command and startup surfaces that expose the same model metadata before a session begins
- Centralized local runtime logging with a CLI log viewer
- A doctor-style diagnostics surface for config/runtime/provider health
- Explicit malformed-config diagnostics for local JSON config files
- Headless server endpoints that surface the same runtime/provider diagnostics as the CLI
- A unified stats dashboard that combines usage, runtime health, and recent error signals

## Success Signals

- `npm test` stays green for runtime, tool, hook, and multi-model suites
- `README.md` matches actual command surface and provider/model claims
- Project docs under `doc/00_project/initiative_forge_cli/` remain current with source layout
- Future feature work lands without reintroducing single-provider coupling

## Current Risks

- Legacy flat docs in `doc/` can drift from current project-level canonical docs
- Marketing-style counts in README/docs can become stale as tool/provider inventories evolve
- Provider routing complexity can leak across unrelated modules if not kept centralized
- Some Hermes-inspired ergonomics are currently Forge-local and not yet extracted to the shared SDK

## Immediate Priorities

1. Keep the new project-level documentation tree as the canonical operating surface.
2. Maintain command/runtime verification discipline (`lint`, `test`, `build`, bench when relevant).
3. Consolidate future architecture and UX updates in the initiative docs instead of adding more flat reference files.
4. Internalize high-value Hermes runtime behavior where the boundary is clearly CLI/runtime focused.
