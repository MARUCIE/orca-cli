# AGENTS.md - Orca CLI Project Conventions

This file governs the entire `MARUCIE-orca-cli` repository.

## Intent

- Maintain Orca CLI as a provider-neutral TypeScript coding-agent runtime.
- Prefer small, auditable diffs over broad rewrites.
- Keep project documentation under `doc/00_project/initiative_orca/` in sync with product behavior.

## Project Map

- CLI entry: `src/bin/orca.ts`
- Command registration: `src/program.ts`
- Command implementations: `src/commands/*.ts`
- Provider bridge: `src/providers/openai-compat.ts`
- Multi-model engine: `src/multi-model.ts`
- Tool surface: `src/tools.ts`
- Runtime config: `src/config.ts`
- Hooks: `src/hooks.ts`
- Usage persistence: `src/usage-db.ts`
- Tests: `tests/*.test.ts`
- Build output: `dist/` (generated, do not hand-edit)

## Working Rules

- Explanations in Chinese; code, comments, and identifiers in English.
- Do not add compatibility layers, fallback branches, or mock flows.
- Reuse existing command, config, and test patterns before introducing new abstractions.
- Do not manually edit generated artifacts in `dist/`; change `src/` and rebuild.
- If command surfaces, model routing, hooks, or tool semantics change, update `README.md` and the project docs in `doc/00_project/initiative_orca/`.

## Verification

- Default verification for meaningful changes:
  - `npm run lint`
  - `npm test`
- If CLI packaging or command wiring changes, also run:
  - `npm run build`
- If benchmark or provider-selection behavior changes, run:
  - `npm run bench`
  - or record why it was not run.

## Documentation Contract

- Canonical project docs live under `doc/00_project/initiative_orca/`.
- Legacy flat docs in `doc/` are reference material until explicitly migrated.
- Before changing behavior, update the relevant project docs if architecture, UX flow, or delivery scope changes.
