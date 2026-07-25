# #225 — Confirm non-admin users can't access admin routes even with a valid session

**State:** PROPOSED
**Depends on:** #185

---

# Confirm non-admin users can't access admin routes even with a valid session

## What & Why
Task #185 added 401 smoke tests confirming every admin route blocks unauthenticated requests.
The next gap is the authenticated-but-not-admin case: a normal logged-in user (isInstanceAdmin=false)
should receive 403, not 200 or 404. The requireInstanceAdmin middleware does handle this path
(DB lookup → 403), but there is no integration test confirming every route applies it correctly
for the session-user path.

## Done looks like
- Extend artifacts/api-server/src/routes/admin.test.ts with a second describe block
- Each route is called with a session user injected on req.user (mock the auth middleware or
  set req.user directly via a middleware in buildApp) and a DB mock that returns
  `{ isInstanceAdmin: false }` for the user lookup
- Every route asserts 403
- The real requireInstanceAdmin middleware still runs (not mocked)

## Relevant files
- `artifacts/api-server/src/routes/admin.test.ts` — extend this file
- `artifacts/api-server/src/middlewares/requireInstanceAdmin.ts` — session-user path (line 64-73)
- `artifacts/api-server/src/middlewares/requireInstanceAdmin.test.ts` — unit tests for reference
