# #504 — Confirm the LocalStorageProvider unit tests pass so storage coverage doesn't have a broken baseline

**State:** PROPOSED
**Depends on:** #495

---

# Confirm the LocalStorageProvider unit tests pass so storage coverage doesn't have a broken baseline

## What & Why

`provider.test.ts` has 9 failing tests (initStorageProvider — local and replit driver paths). They fail because the dynamic require('./local') call can't resolve the module in the Vitest ESM environment. This breaks the test baseline for all storage work and means CI cannot reliably catch regressions.

## Done looks like

- All tests in `artifacts/api-server/src/lib/storage/provider.test.ts` pass under `pnpm --filter @workspace/api-server test`
- No mocking workarounds that mask the actual module resolution problem

## Relevant files

- `artifacts/api-server/src/lib/storage/provider.ts`
- `artifacts/api-server/src/lib/storage/provider.test.ts`
