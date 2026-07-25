# #431 — Confirm suspended-org modal blocks access on task and project routes mid-session

**State:** PROPOSED
**Depends on:** #430

---

# Confirm suspended-org modal blocks access on task and project routes mid-session

## What & Why
The OrgSuspendedModal fires when `onOrgSuspended` emits (any 403 org_suspended response). But we haven't confirmed that the middleware actually returns `{ error: 'org_suspended' }` consistently on task routes, project routes, and comment routes — not just the org middleware unit tests. Without a live-DB integration test, a future middleware refactor could silently break the signal chain.

## Done looks like
- Integration tests confirm that GET /tasks, GET /projects, and POST /comments each return 403 { error: 'org_suspended' } when the org's isDisabled flag is true in the database.
- Covers both session-cookie and API-key callers.

## Relevant files
- `artifacts/api-server/src/middlewares/requireOrgMiddleware.ts:44,80`
- `artifacts/api-server/src/routes/tasks.ts`
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/comments.ts`
