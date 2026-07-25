# #360 — Harden the audit-log admin smoke test so it fully verifies a 200 response, not just 'not 403'

**State:** PROPOSED
**Depends on:** #357

---

# Harden the audit-log admin smoke test

## What & Why
The admin positive-control test in `routes/admin-guard.test.ts` (task #323 coverage) was simplified to `not.toBe(403)` because the audit-log route's internal DB queries (orgEvents + taskEvents, both using `.limit()` as the terminal chain method) don't resolve correctly through the existing makeChain mock in that file.  The member→403 gate test is solid; the admin→200 is a weak assertion.

## Done looks like
- The `makeChain` helper in admin-guard.test.ts is extended so that `.orderBy().limit()` correctly terminates with the selectQueue result (orderBy currently returns chain but limit is the terminal — the two routes' query patterns need both `.limit()` and the `.then()` path to coexist)
- OR: the admin test is extracted to its own describe that mocks requireOrgMiddleware directly (matching the pattern used in orgs.test.ts) and pushes the correct org+task event results
- The test assertion changes from `not.toBe(403)` → `toBe(200)` and verifies `res.body.events` is an array

## Relevant files
- `artifacts/api-server/src/routes/admin-guard.test.ts` (lines 558-582, the "does NOT return 403" test)
- `artifacts/api-server/src/routes/audit-log.ts` (the route being tested)
