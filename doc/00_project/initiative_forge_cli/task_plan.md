# Task Plan

## Active Task

- Task: Internalize Hermes-inspired runtime capabilities into Forge CLI
- Status: completed
- Started: 2026-04-12

## Plan

1. Map Hermes v0.8.0 capabilities against Forge CLI and Armature SDK boundaries.
2. Implement the first Hermes-inspired runtime bundle in Forge CLI:
   - tool argument coercion
   - oversized tool result persistence
   - background completion notifications
3. Update canonical project docs and README to reflect the new runtime behavior.
4. Decide whether SDK code must change; if not, record why the boundary stays Forge-local.
5. Run full verification (`lint`, `test`, `build`, `bench`, smoke tests).

## Exit Criteria

- Hermes-inspired capability bundle is implemented and documented in Forge CLI
- Runtime boundaries between Forge CLI and Armature SDK are explicitly recorded
- Verification evidence logged in `deliverable.md`

## Verification Summary

- `npm run lint` ✅
- `npm test` ✅ (`426/426` tests passed)
- `npm run build` ✅
- `npm run bench` ✅ (`10/10`, `100%`)
- `node dist/bin/forge.js --help` ✅
- `vitest run tests/hermes-runtime.test.ts` ✅ (`3/3`)
- `vitest run tests/model-catalog.test.ts` ✅ (`4/4`)
- `vitest run tests/model-catalog.test.ts tests/providers-command.test.ts` ✅ (`5/5`)
- `node dist/bin/forge.js providers` ✅
- `vitest run tests/logger.test.ts tests/logs-command.test.ts tests/program.test.ts` ✅ (`12/12`)
- `node dist/bin/forge.js logs` ✅
- `node dist/bin/forge.js doctor --json` ✅
- `vitest run tests/doctor-command.test.ts tests/logger.test.ts tests/logs-command.test.ts tests/program.test.ts` ✅ (`14/14`)
- `vitest run tests/serve-command.test.ts` ✅ (`1/1`)
- `vitest run tests/stats-command.test.ts` ✅ (`1/1`)
