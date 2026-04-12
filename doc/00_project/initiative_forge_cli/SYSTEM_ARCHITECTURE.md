# Forge CLI System Architecture

<!-- AI-FLEET:PROJECT_DIR:START -->
- `PROJECT_DIR`: `/Users/mauricewen/Projects/MARUCIE-forge-cli`
<!-- AI-FLEET:PROJECT_DIR:END -->

## Architecture Summary

Forge CLI is a TypeScript ESM CLI product composed of a terminal entry layer, command layer, runtime/config layer, provider bridge, and test/verification layer. It is a CLI runtime, so the primary surface is command invocation and streaming terminal output rather than browser routes.

## High-Level Diagram

```mermaid
flowchart TD
  User[Developer in Terminal]
  Bin[src/bin/forge.ts]
  Program[src/program.ts]
  Commands[src/commands/*.ts]
  Runtime[src/commands/chat.ts<br/>src/commands/run.ts]
  Doctor[src/doctor.ts]
  Multi[src/multi-model.ts]
  ModelCatalog[src/model-catalog.ts]
  Config[src/config.ts]
  Provider[src/providers/openai-compat.ts]
  Tools[src/tools.ts]
  BgJobs[src/background-jobs.ts]
  Logger[src/logger.ts]
  Hooks[src/hooks.ts]
  Usage[src/usage-db.ts]
  Output[src/output.ts<br/>src/markdown.ts]
  Tests[tests/*.test.ts]

  User --> Bin --> Program --> Commands
  Commands --> Runtime
  Commands --> Doctor
  Commands --> Multi
  Commands --> ModelCatalog
  Runtime --> Config
  Multi --> Config
  Runtime --> Provider
  Multi --> Provider
  Runtime --> Tools
  Runtime --> BgJobs
  Runtime --> Logger
  Runtime --> Hooks
  Runtime --> Usage
  Runtime --> Output
  Tests --> Commands
  Tests --> Multi
  Tests --> Hooks
  Tests --> Provider
  Tests --> Tools
```

## Layer Breakdown

| Layer | Files | Responsibility |
| --- | --- | --- |
| Entry | `src/bin/forge.ts` | Shell entry point and signal handling |
| Command assembly | `src/program.ts` | Registers commands and default prompt passthrough |
| Command modules | `src/commands/*.ts` | User-facing CLI flows (`chat`, `run`, `multi`, `bench`, `providers`, `stats`, `session`, `pr`, `serve`, `init`) |
| Runtime/config | `src/config.ts`, `src/context.ts`, `src/system-prompt.ts`, `src/token-budget.ts`, `src/model-catalog.ts`, `src/doctor.ts` | Resolve providers, model metadata, runtime diagnostics, context, prompts, and runtime limits |
| Provider bridge | `src/providers/openai-compat.ts` | Provider-neutral transport and model interaction |
| Agent runtime | `src/tools.ts`, `src/background-jobs.ts`, `src/logger.ts`, `src/hooks.ts`, `src/mcp-client.ts`, `src/retry-intelligence.ts`, `src/auto-verify.ts` | Tool execution, detached job tracking, local runtime logging, hooks, MCP, retry behavior, verification helpers |
| Presentation | `src/output.ts`, `src/markdown.ts`, `src/command-picker.ts` | Terminal rendering and output formatting |
| Persistence | `src/usage-db.ts` | Persistent usage/cost tracking |
| Verification | `tests/*.test.ts` | Automated verification across tool, runtime, hook, SOTA, and multi-model paths |

## Command Surface Map

| Command | Source File | Purpose |
| --- | --- | --- |
| `forge` / `forge chat` | `src/commands/chat.ts` | Interactive REPL and one-shot prompting |
| `forge run` | `src/commands/run.ts` | Agent task execution |
| `forge council` / `forge race` / `forge pipeline` | `src/commands/multi.ts` | Multi-model collaboration flows |
| `forge bench` | `src/commands/bench.ts` | Benchmark and self-evaluation |
| `forge providers` | `src/commands/providers.ts` | Provider introspection |
| `forge stats` | `src/commands/stats.ts` | Usage/cost reporting |
| `forge session` | `src/commands/session.ts` | Session lifecycle |
| `forge pr` | `src/commands/pr.ts` | Pull request review workflow |
| `forge serve` | `src/commands/serve.ts` | Headless HTTP + SSE runtime |
| `forge init` | `src/commands/init.ts` | Local configuration bootstrap |

## Route / Page Map

- Web routes: `N/A`
- Primary interaction surface: terminal commands and REPL slash-style workflows
- Headless HTTP surface: `forge serve` (see `src/commands/serve.ts`)
- Detached job state: `~/.armature/background-jobs/` or `$ARMATURE_HOME/background-jobs/`
- Runtime logs: `~/.armature/logs/` or `$ARMATURE_HOME/logs/`
- Serve diagnostics: `/health`, `/providers`, `/doctor`

## Legacy Documentation Cross-References

- `doc/THREE_TIER_ARCHITECTURE.md`: historical broader ecosystem architecture
- `doc/MULTI_MODEL_COLLABORATION.md`: early collaboration-mode design
- `doc/SOTA_TEST_PLAN.md`: historical hardening plan
