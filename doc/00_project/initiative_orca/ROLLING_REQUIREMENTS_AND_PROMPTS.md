# Rolling Requirements And Prompts

## Requirements Ledger

| ID | Date | Type | Requirement | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| REQ-001 | 2026-04-12 | governance | Treat `/Users/mauricewen/Projects/MARUCIE-orca-cli` as canonical `PROJECT_DIR` and bootstrap project-level agent/doc entry files | done | Root docs + canonical initiative tree created |
| REQ-002 | 2026-04-12 | docs | Create structured path index, architecture summary, and CLI command-surface map before future code edits | done | `doc/index.md`, `SYSTEM_ARCHITECTURE.md`, `USER_EXPERIENCE_MAP.md` |
| REQ-003 | 2026-04-12 | docs | Keep planning/architecture HTML companions complete and derived from canonical Markdown rather than hand-maintained summaries | done | 7 companion `.html` files regenerated from `.md` sources |
| REQ-004 | 2026-04-12 | governance | Keep `CLAUDE.md` as the single project guidance source; `CODEX.md` and `GEMINI.md` should be thin references, not duplicated copies | done | Root mirror files reduced to canonical references |
| REQ-005 | 2026-04-12 | test-harness | `git_commit` must fail gracefully in non-repo directories without leaking raw git stderr into the outer test runner | done | `src/tools.ts` pipes child stdio; `tests/protocol.test.ts` adds non-repo coverage |
| REQ-006 | 2026-04-12 | feature | Internalize Hermes-inspired runtime ergonomics into Orca CLI, prioritizing core agent-loop capabilities over gateway/platform-specific features | done | Hermes release mapped to Orca runtime boundaries and implemented in Orca-local runtime seams |
| REQ-007 | 2026-04-12 | feature | First capability bundle should cover tool arg coercion, oversized tool result persistence, and background completion notifications | done | `src/tools.ts`, `src/background-jobs.ts`, `tests/hermes-runtime.test.ts` |
| REQ-008 | 2026-04-12 | architecture | Update SDK only if the new capability crosses a reusable provider-neutral runtime seam | done | `MARUCIE-open-agent-sdk` reviewed; no code change required for this Orca-local bundle |
| REQ-009 | 2026-04-12 | feature | Replace hard-coded model selection with a provider-aware model catalog that exposes context, pricing, and caution metadata | done | `src/model-catalog.ts`, `src/commands/chat.ts`, `tests/model-catalog.test.ts` |
| REQ-010 | 2026-04-12 | feature | Reuse the model catalog in `orca providers` and startup output so pre-session inspection matches in-session model selection | done | `src/commands/providers.ts`, `src/commands/chat.ts`, `tests/providers-command.test.ts` |
| REQ-011 | 2026-04-12 | feature | Add Hermes-inspired centralized runtime logging and a lightweight `orca logs` surface | done | `src/logger.ts`, `src/commands/logs.ts`, `tests/logger.test.ts`, `tests/logs-command.test.ts` |
| REQ-012 | 2026-04-12 | feature | Add a doctor-style diagnostics surface so Orca runtime/config health can be inspected without manual file spelunking | done | `src/doctor.ts`, `src/commands/doctor.ts`, `tests/doctor-command.test.ts` |
| REQ-013 | 2026-04-12 | feature | Doctor should explicitly report malformed local JSON config files rather than relying on generic parse warnings | done | `src/config-diagnostics.ts`, `src/doctor.ts`, `tests/doctor-command.test.ts` |
| REQ-014 | 2026-04-12 | feature | Headless server endpoints should expose the same runtime/provider diagnostics already available in CLI surfaces | done | `src/commands/serve.ts`, `tests/serve-command.test.ts` |
| REQ-015 | 2026-04-12 | feature | `orca stats` should evolve from cost-only output into a runtime dashboard that reuses doctor/logger signals | done | `src/commands/stats.ts`, `tests/stats-command.test.ts` |
| REQ-016 | 2026-04-12 | branding | Active source-of-truth docs and governance files should use Orca branding while preserving the actual current repo path until the directory itself is renamed | done | `AGENTS.md`, `doc/index.md`, `doc/00_project/initiative_orca/*.md` |

## Prompt / Workflow Notes

| ID | Prompt Pattern | Intent | Notes |
| --- | --- | --- | --- |
| PROMPT-001 | Project directory only | Bootstrap project governance before feature work | Root agent files + canonical docs are now the first action |
| PROMPT-002 | Internalize Hermes abilities into Orca CLI | Map Hermes release items to Orca-local runtime seams first; only change SDK if the seam is genuinely reusable | Active task branch |

## Anti-Regression Q&A

| Question | Answer |
| --- | --- |
| What is the canonical project doc root? | `doc/00_project/initiative_orca/` |
| Where should architecture and UX updates go? | `SYSTEM_ARCHITECTURE.md` and `USER_EXPERIENCE_MAP.md` in the initiative tree |
| Does this repo have web routes? | No. Treat command surfaces as the UX map. |
| How should companion HTML docs be maintained? | Regenerate them from the Markdown source; do not maintain abridged manual summaries. |
| Which file is the canonical root guidance for agent-specific mirrors? | `CLAUDE.md` |
| How should `git_commit` behave outside a git repo? | Return a normal tool failure payload, not leak raw child-process stderr to the test runner. |
| Which Hermes-inspired capabilities are now internalized in Orca? | Tool arg coercion, oversized tool result persistence, detached background work, provider-aware model inspection, local logs, doctor diagnostics, serve metadata parity, and stats runtime dashboarding. |
| Did the SDK need a matching code change? | No. This bundle is Orca-local runtime ergonomics, not a shared SDK seam yet. |
| What does `/models` show now? | Provider-aware model choices with context window, approximate pricing, and caution metadata instead of a hard-coded Poe-only list. |
| What does `orca providers` add now? | It shows readiness plus the same context/pricing/caution metadata used by the REPL model catalog. |
| Where do Orca runtime logs live now? | `~/.orca/logs/` or `$ORCA_HOME/logs/`, with `agent.log` and `errors.log`. |
| What does `orca doctor` cover? | Provider/config readiness, hooks, MCP, sessions, background jobs, log files, project context, and git availability. |
| How are malformed config files surfaced now? | Through `doctor` config diagnostics; parse failures are logged locally and reported explicitly in doctor output. |
| What does `orca serve` expose now beyond raw chat? | `/health`, `/providers`, and `/doctor` all reuse the same provider/model/runtime diagnostics as the CLI. |
| What does `orca stats` show now beyond usage? | Runtime health and recent error summaries, sourced from doctor/logger alongside usage-db. |
| Why is the SDK still unchanged? | These Hermes-inspired slices are still Orca-local runtime ergonomics; no reusable provider-neutral seam has been justified yet. |
| Why does the repo path still say `MARUCIE-orca-cli`? | The product brand is Orca, but the filesystem repo directory has not been renamed yet, so canonical docs preserve the real path. |

## References

- `README.md`
- `src/program.ts`
- `src/commands/multi.ts`
- `doc/THREE_TIER_ARCHITECTURE.md`
