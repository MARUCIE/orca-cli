# Deliverable

## Scope

Internalize the first Hermes-inspired runtime capability bundle into Orca CLI and keep canonical project docs in sync.

## Delivered

- Root governance files: `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `GEMINI.md`
- Git hygiene update: `.gitignore` now ignores `.omx/`
- Canonical project doc tree under `doc/00_project/initiative_orca/`
- Initial PRD, architecture summary, CLI UX map, optimization plan, and workflow assets
- Review follow-up:
  - 7 complete `.html` companions regenerated from canonical `.md` files
  - `CODEX.md` and `GEMINI.md` reduced to canonical references to avoid drift
  - `git_commit` non-repo failure path hardened to keep git stderr inside the tool result
  - Regression coverage added for `git_commit` in non-repo directories
- Hermes-inspired runtime bundle:
  - tool arg coercion for stringified number/boolean/array tool inputs
  - oversized tool result persistence to `~/.orca/tool-results/`
  - background job tracking + completion notifications via `src/background-jobs.ts`
  - REPL `/jobs` view for tracked detached work
- Model/provider ergonomics bundle:
  - `src/model-catalog.ts` centralizes model metadata
  - `/model` now shows provider, context, pricing, and caution notes
  - `/models` now lists provider-aware choices instead of a hard-coded Poe-only set
  - `orca providers` now shows the same context/pricing/caution metadata before a session starts
- Centralized logging bundle:
  - `src/logger.ts` writes local runtime logs under `~/.orca/logs/` or `$ORCA_HOME/logs/`
  - `orca logs` and `orca logs errors` surface recent log entries
  - key runtime warning/error/info events now persist beyond the terminal session
- Doctor diagnostics bundle:
  - `src/doctor.ts` gathers provider/config/hook/MCP/session/background-job/log diagnostics
  - `orca doctor` and `orca doctor --json` expose that state directly
  - malformed JSON config files are reported explicitly through doctor diagnostics instead of relying on generic terminal noise
- Serve observability bundle:
  - `orca serve` now reuses doctor/model-catalog metadata in `/health`, `/providers`, and `/doctor`
  - headless clients can inspect the same runtime state surfaces as CLI users
- Stats dashboard bundle:
  - `orca stats` now combines usage/cost, runtime health, and recent error summaries
- SDK boundary:
  - `MARUCIE-open-agent-sdk` reviewed repeatedly but still intentionally unchanged
  - Current Hermes-inspired slices remain Orca-local runtime ergonomics rather than shared provider-neutral SDK seams
- SDK boundary:
  - `MARUCIE-open-agent-sdk` reviewed but not changed; this bundle remains Orca-local for now

## Verification

- Structure verification:
  - `find doc/00_project -maxdepth 3 -type f | sort`
- Repo verification:
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `npm run bench`
  - `node dist/bin/orca.js --help`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/adversarial.test.ts tests/protocol.test.ts`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/hermes-runtime.test.ts`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/model-catalog.test.ts`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/model-catalog.test.ts tests/providers-command.test.ts`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/logger.test.ts tests/logs-command.test.ts tests/program.test.ts`
  - `OPENAI_API_KEY=test-openai-key ORCA_PROVIDER=openai node dist/bin/orca.js providers`
  - `ORCA_HOME=$(mktemp -d) node dist/bin/orca.js logs`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/doctor-command.test.ts`
  - `OPENAI_API_KEY=test-openai-key ORCA_PROVIDER=openai node dist/bin/orca.js doctor --json`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/serve-command.test.ts`
  - `node --experimental-vm-modules node_modules/.bin/vitest run tests/stats-command.test.ts`
- Result:
  - `lint` passed
  - `test` passed (`426/426`)
  - `build` passed
  - `bench` passed (`10/10`, `100%`)
  - CLI help smoke test passed
  - Targeted regression rerun passed (`34/34`)
  - Hermes runtime targeted suite passed (`3/3`)
  - Model catalog targeted suite passed (`4/4`)
  - Provider command targeted suite passed (`5/5`)
  - Built provider listing smoke test passed
  - Logger/logs command targeted suite passed (`12/12`)
  - Built logs command smoke test passed
  - Doctor command targeted suite passed (`1/1`)
  - Built doctor command smoke test passed
  - Serve command targeted suite passed (`1/1`)
  - Stats command targeted suite passed (`1/1`)

## Remaining Risks

- Legacy flat docs in `doc/` still exist and may need deliberate migration or cross-link maintenance
- Runtime code changed only in the `git_commit` stderr-handling path, and that path is now covered by both targeted and full-suite verification
- No known blocking issues remain from this Hermes-internalization branch
