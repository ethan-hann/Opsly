# #506 — Fix the pre-existing provider.test.ts failures so storage driver tests aren't silently broken

**State:** PROPOSED
**Depends on:** #496

---

# Fix the pre-existing provider.test.ts failures so storage driver tests aren't silently broken

## What & Why

`src/lib/storage/provider.test.ts` currently fails with "Cannot find module './local'" for every factory test and unexpected `process.exit` calls in the init tests. These 9 failures are pre-existing and unrelated to the path-traversal fix, but they mean the storage driver factory has no passing test coverage. A breakage in driver selection or init logic would be invisible.

## Done looks like

- All tests in `provider.test.ts` pass in CI (vitest run)
- Root cause (module resolution mismatch or import ordering) is identified and fixed
- No new test infrastructure is added; existing tests are corrected

## Relevant files

- `artifacts/api-server/src/lib/storage/provider.ts`
- `artifacts/api-server/src/lib/storage/provider.test.ts`
