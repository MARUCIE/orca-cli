# Forge CLI User Experience Map

<!-- AI-FLEET:PROJECT_DIR:START -->
- `PROJECT_DIR`: `/Users/mauricewen/Projects/MARUCIE-forge-cli`
<!-- AI-FLEET:PROJECT_DIR:END -->

## Experience Model

Forge CLI is a command-first product. User journeys are structured around terminal entry points, not URLs.

## Journey Map

| Journey | User Intent | Command / Entry | Source |
| --- | --- | --- | --- |
| Onboard | Configure a provider and initialize usage | `forge init`, env vars, config files | `src/commands/init.ts`, `src/config.ts` |
| Explore interactively | Ask questions or operate in a REPL | `forge`, `forge chat` | `src/bin/forge.ts`, `src/commands/chat.ts` |
| Diagnose the runtime | Check config/provider/hook/MCP/session/log state before debugging by hand | `forge doctor` | `src/commands/doctor.ts`, `src/doctor.ts` |
| Pick a model safely | Inspect provider, context window, approximate pricing, and caution notes before switching | `/model`, `/models` | `src/commands/chat.ts`, `src/model-catalog.ts` |
| Check providers before starting | Inspect provider readiness and default-model metadata before entering a session | `forge providers`, `forge providers test` | `src/commands/providers.ts`, `src/model-catalog.ts` |
| Inspect runtime logs | Read recent info/warn/error entries without opening files manually | `forge logs`, `forge logs errors` | `src/commands/logs.ts`, `src/logger.ts` |
| Review runtime dashboard | See usage, runtime health, and recent error signals in one place | `forge stats` | `src/commands/stats.ts`, `src/doctor.ts`, `src/logger.ts` |
| Inspect headless runtime state | Query health/provider/doctor metadata over HTTP before attaching a client | `forge serve` + `GET /health|/providers|/doctor` | `src/commands/serve.ts`, `src/doctor.ts`, `src/model-catalog.ts` |
| Execute work | Run a coding or analysis task | `forge run` | `src/commands/run.ts` |
| Compare models | Get multiple opinions or race for speed | `forge council`, `forge race`, `forge pipeline` | `src/commands/multi.ts`, `src/multi-model.ts` |
| Inspect routing | Check configured providers | `forge providers` | `src/commands/providers.ts` |
| Review cost and sessions | Inspect usage history and saved sessions | `forge stats`, `forge session` | `src/commands/stats.ts`, `src/commands/session.ts` |
| Track background work | Start detached work and get notified when it finishes | `run_background`, `/jobs` | `src/tools.ts`, `src/background-jobs.ts`, `src/commands/chat.ts` |
| Review a PR | Pull and review GitHub PRs | `forge pr` | `src/commands/pr.ts` |
| Run headless | Expose the runtime over HTTP/SSE | `forge serve` | `src/commands/serve.ts` |
| Benchmark quality | Measure runtime quality and capability | `forge bench` | `src/commands/bench.ts` |

## Command Flow Details

### 1. REPL / One-Shot Flow

1. User invokes `forge` or `forge chat`.
2. `src/bin/forge.ts` hands off to `src/program.ts`.
3. `src/commands/chat.ts` resolves config, model, prompt, tool loop, and streaming output.
4. User receives formatted markdown and tool events in terminal.

### 1b. Model Selection Flow

1. User invokes `/model` or `/models`.
2. `src/model-catalog.ts` derives model metadata from config + known model hints.
3. The REPL shows provider, context window, approximate pricing, and caution notes.
4. If a cautionary model is selected, the REPL warns immediately instead of failing later through degraded tool use.

### 1c. Provider Inspection Flow

1. User invokes `forge providers` or `forge providers test`.
2. `src/commands/providers.ts` resolves configured providers and decorates them with model-catalog metadata.
3. The CLI shows readiness plus context/pricing/caution data before the user commits to a session or connectivity test.

### 1d. Doctor Flow

1. User invokes `forge doctor`.
2. `src/doctor.ts` gathers provider, project, hook, MCP, session, background-job, and log diagnostics.
3. The command emits either a human-readable health summary or JSON for automation.
4. Malformed local JSON config files are called out explicitly instead of being hidden in generic stderr noise.

### 1f. Serve Metadata Flow

1. User starts `forge serve`.
2. HTTP clients can call `/health`, `/providers`, and `/doctor`.
3. The headless server returns the same provider/runtime metadata already exposed in the CLI surfaces.

### 1g. Stats Dashboard Flow

1. User invokes `forge stats`.
2. `src/commands/stats.ts` reads usage history from SQLite.
3. The command merges in runtime health from `doctor` and recent errors from the local logger.
4. The user sees both cost metrics and operational state in a single output.

### 1e. Runtime Log Flow

1. Runtime warnings/errors and selected info events are persisted via `src/logger.ts`.
2. Files are written to `~/.armature/logs/` (or `$ARMATURE_HOME/logs/`).
3. `forge logs` and `forge logs errors` surface recent entries without requiring direct file inspection.

### 2. Task Execution Flow

1. User invokes `forge run "task"`.
2. `src/commands/run.ts` packages the task for the runtime.
3. Runtime resolves provider/model config and tool permissions.
4. Output streams back through `src/output.ts` and `src/markdown.ts`.

### 3. Multi-Model Collaboration Flow

1. User chooses `council`, `race`, or `pipeline`.
2. `src/commands/multi.ts` resolves provider strategy.
3. `src/multi-model.ts` coordinates parallel or staged calls.
4. Result is rendered with verdict, winner, or stage-by-stage output.

### 4. Background Job Flow

1. The agent invokes `run_background`.
2. `src/background-jobs.ts` creates a tracked detached job and log artifact.
3. The REPL surfaces completion notifications before the next prompt.
4. `/jobs` provides a quick state view without falling back to raw PID inspection.

## UX Constraints

- No browser dependency for core workflows
- Provider configuration must stay legible from CLI affordances
- Multi-model output must remain understandable in a terminal session
- Safe mode vs YOLO mode must remain obvious when dangerous actions exist
- Detached work must stay observable without forcing manual shell polling
- Model switching should expose enough metadata to prevent obviously bad runtime choices
- Runtime diagnostics should stay available even after the terminal session ends
- The runtime should provide one explicit health-check surface before users fall back to manual file inspection

## Page / Route Equivalents

| Equivalent Surface | Value |
| --- | --- |
| Web pages | `N/A` |
| Primary navigation | top-level commands in `src/program.ts` |
| Secondary navigation | slash commands and options inside REPL / command modules, including `/jobs` for detached work |
| API surface | headless serve mode from `src/commands/serve.ts` |
