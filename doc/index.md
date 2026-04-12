# Forge CLI Docs Index

This file is the canonical path index for the `Forge CLI` repository.

## Active Initiative

- Initiative: `doc/00_project/initiative_forge_cli/`
- Scope: project-level governance, architecture, UX flow, delivery planning, and rolling requirements

## Path Index

<!-- AI-FLEET:PATH_INDEX:START -->
| Area | Path | Notes |
| --- | --- | --- |
| Project root | `/Users/mauricewen/Projects/MARUCIE-forge-cli` | Git root and canonical `PROJECT_DIR` |
| CLI entry | `src/bin/forge.ts` | Node executable entry point |
| Program assembly | `src/program.ts` | Registers all top-level commands |
| Commands | `src/commands/` | `chat`, `run`, `multi`, `bench`, `providers`, `stats`, `session`, `pr`, `serve`, `init` |
| Provider bridge | `src/providers/openai-compat.ts` | Provider-neutral runtime transport layer |
| Multi-model engine | `src/multi-model.ts` | Council, race, pipeline orchestration |
| Tool surface | `src/tools.ts` | Agent tools available to the runtime |
| Background job tracking | `src/background-jobs.ts` | Detached job registry, log paths, and completion notifications |
| Runtime logging | `src/logger.ts` | Local `agent.log` / `errors.log` persistence |
| Doctor diagnostics | `src/doctor.ts` | Structured runtime/config/provider diagnostics |
| Runtime config | `src/config.ts` | Provider/model resolution and config loading |
| Hooks | `src/hooks.ts` | Lifecycle hook loader and execution |
| Usage persistence | `src/usage-db.ts` | Usage and cost persistence |
| Tests | `tests/` | Vitest suites for CLI, runtime, hooks, multi-model, and SOTA behavior |
| Build output | `dist/` | Generated artifacts, not hand-edited |
| Legacy docs | `doc/THREE_TIER_ARCHITECTURE.md` | Historical architecture inventory |
| Legacy docs | `doc/MULTI_MODEL_COLLABORATION.md` | Design note for council/race/pipeline |
| Legacy docs | `doc/SOTA_TEST_PLAN.md` | Historical test hardening plan |
<!-- AI-FLEET:PATH_INDEX:END -->

## Documentation Layout

- `doc/00_project/index.md`: project initiative list
- `doc/00_project/initiative_forge_cli/`: active project docs and workflow assets
- `doc/*.md`: legacy flat docs retained as references until intentionally migrated

## Notes

- This repository is a CLI product. It has command surfaces rather than web routes.
- Use `USER_EXPERIENCE_MAP.md` for command-entry and user-flow mapping.
