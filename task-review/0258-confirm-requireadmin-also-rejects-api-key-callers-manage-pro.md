# #258 — Confirm requireAdmin also rejects API-key callers (manage_projects gate)

**State:** PROPOSED
**Depends on:** #186

---

# Extend API-key rejection coverage to requireAdmin

## What & Why
Task #186 confirmed that requirePermission and requireOwner both reject API-key
callers on the routes covered by admin-guard.test.ts. requireAdmin (used to gate
manage_projects routes) also calls rejectApiKey() but is not covered by the new
tests — its guard path is exercised on different routes (e.g. project management
endpoints) not mounted in the admin-guard test app.

## Done looks like
- admin-guard.test.ts (or a new test file) mounts a route that uses requireAdmin
  and asserts 403 + /session/i error when req.apiKeyId is set
- Alternatively, if a projects.test.ts or similar already imports the real
  requireOrgMiddleware, add the API-key test there
- All existing tests still pass

## Relevant files
- artifacts/api-server/src/middlewares/requireOrgMiddleware.ts — requireAdmin
- artifacts/api-server/src/routes/admin-guard.test.ts — pattern to follow
