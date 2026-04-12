# CLAUDE.md - Orca CLI Project Guide

This repository-specific guide complements the global defaults inherited from `/Users/mauricewen/CLAUDE.md`.

## Repository Facts

- Project name: `Orca CLI`
- Package: `orca-cli`
- Runtime: Node.js `>=18`
- Language: TypeScript with ESM
- Build command: `npm run build`
- Test command: `npm test`
- Typecheck command: `npm run lint`
- Benchmark command: `npm run bench`

## Canonical Paths

- Project docs: `doc/00_project/initiative_orca/`
- Source: `src/`
- Tests: `tests/`
- Generated output: `dist/`
- Legacy reference docs: `doc/THREE_TIER_ARCHITECTURE.md`, `doc/MULTI_MODEL_COLLABORATION.md`, `doc/SOTA_TEST_PLAN.md`

## Repo-Specific Rules

- Treat this repo as a CLI product, not a web app; user journeys are command flows rather than URL routes.
- Keep `README.md` aligned with real command availability and provider/model claims.
- Prefer extending the existing command modules in `src/commands/` over adding parallel command systems.
- Keep provider-neutral routing in config or provider-bridge layers; avoid model-specific behavior leaking into unrelated modules.
- When tests or docs describe counts, capabilities, or model/provider matrices, update them in the same task if behavior changed.

## Delivery Expectations

- Document substantial work in `doc/00_project/initiative_orca/task_plan.md`, `notes.md`, and `deliverable.md`.
- Update project-level architecture, UX map, PRD, and optimization plan when the task changes system boundaries or user-facing flows.
- Do not claim completion without reporting what was verified and what remains unverified.
