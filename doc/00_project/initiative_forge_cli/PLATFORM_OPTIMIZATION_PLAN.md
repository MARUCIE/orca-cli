# Forge CLI Platform Optimization Plan

## Objective

Keep Forge CLI maintainable as a fast-moving CLI runtime while preventing drift across docs, command surfaces, and provider-routing behavior.

## Current Optimization Targets

| Area | Current State | Next Step |
| --- | --- | --- |
| Governance entry files | Root guidance files now exist | Keep `CLAUDE.md` canonical and keep `CODEX.md` / `GEMINI.md` as thin references rather than duplicated copies |
| Project docs structure | Flat legacy docs plus new initiative tree | Use `doc/00_project/initiative_forge_cli/` as canonical source going forward |
| Runtime state hygiene | `.omx/` existed as untracked runtime state | Ignore `.omx/` in git and keep runtime state out of source control |
| Hermes-inspired runtime ergonomics | Forge lacked detached-job and oversized-result UX | Keep high-value runtime resilience features in Forge where no gateway abstraction is required |
| Model switching ergonomics | `/models` was a hard-coded list with weak runtime hints | Keep provider-aware model metadata in a single catalog instead of scattering it across REPL code |
| Provider inspection ergonomics | `forge providers` only showed a thin readiness table | Reuse the same model catalog so provider inspection and REPL selection stay consistent |
| Runtime diagnostics | Warnings/errors were terminal-only and ephemeral | Persist local logs and expose them through a simple CLI log surface |
| Health-check ergonomics | Runtime state required manual inspection across config, hooks, MCP, and sessions | Add a single doctor-style command for local diagnostics |
| Config failure visibility | Malformed JSON config could degrade into scattered warnings | Surface config parse failures directly in doctor output |
| Headless parity | `forge serve` originally exposed a thin status surface | Reuse doctor/model metadata in server endpoints instead of inventing a second observability model |
| Stats visibility | `forge stats` only covered usage/cost | Merge runtime health and error signals into the stats surface |
| Command/document parity | README can drift from actual registrations | Treat `src/program.ts` as source of truth and update docs in the same task |
| Architecture visibility | Historical architecture doc existed, but not repo-specific canonical doc | Maintain `SYSTEM_ARCHITECTURE.md` and `USER_EXPERIENCE_MAP.md` as live docs |
| Verification discipline | Tests exist but repo-level process docs were missing | Keep task-level verification logged in `deliverable.md` and `notes.md` |
| HTML companion drift | Hand-maintained summaries can diverge from Markdown | Regenerate planning/architecture HTML companions from the canonical `.md` source |

## Planned Improvements

1. Migrate future architecture/product updates into the initiative docs instead of adding new flat docs.
2. Keep provider/model/tool count claims sourced from code or explicitly dated when narrative docs summarize them.
3. Add release-time doc verification to ensure README and canonical docs stay aligned with command registration.
4. Expand headless/API documentation when `forge serve` grows beyond current HTTP + SSE scope.

## Guardrails

- No backward-compatibility shims for obsolete surfaces
- No mock-only validation
- No manual edits in `dist/`
- No new dependency added without explicit request
