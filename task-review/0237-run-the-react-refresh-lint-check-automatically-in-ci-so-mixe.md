# #237 — Run the react-refresh lint check automatically in CI so mixed exports are caught before merge

**State:** PROPOSED
**Depends on:** #111

---

# Run the react-refresh lint check automatically in CI so mixed exports are caught before merge

## What & Why
Task #111 added `eslint-plugin-react-refresh` and the `only-export-components` rule so
mixed exports are caught at save time in the editor. The rule only runs if a developer
remembers to run `pnpm lint` locally. Wiring the lint check into the orval-sync or
typecheck workflow (or a new dedicated lint workflow) ensures the check runs on every
push and CI pipeline, so the safety net works even when a developer skips local linting.

## Done looks like
- A `lint` workflow is added alongside the existing `typecheck` workflow in the Replit
  workflow config, running `pnpm --filter @workspace/it-task-manager run lint`
- The workflow exits non-zero on any warning (add `--max-warnings 0` to the lint script)
- Or, the existing typecheck workflow is extended to run lint before tsc

## Relevant files
- `artifacts/it-task-manager/package.json` — lint script already added (task #111)
- `artifacts/it-task-manager/eslint.config.js` — rule config
- Replit workflow configuration
