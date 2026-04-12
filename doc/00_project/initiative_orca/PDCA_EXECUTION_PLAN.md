# Orca CLI PDCA Execution Plan

## Plan

- Use the initiative docs as the single project-level planning surface.
- Ground architecture and UX descriptions in actual source files.

## Do

- Implement changes in `src/` or tests as required by the active task.
- Update project docs in the same task when system boundaries or user flows change.

## Check

- Default: `npm run lint` and `npm test`
- Add `npm run build` when command assembly or packaging changes
- Add `npm run bench` when benchmark- or capability-facing behavior changes

## Act

- Record evidence and residual gaps in `deliverable.md`
- Roll forward requirements and anti-regression notes in `ROLLING_REQUIREMENTS_AND_PROMPTS.md`
