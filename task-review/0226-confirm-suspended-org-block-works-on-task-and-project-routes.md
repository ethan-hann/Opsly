# #226 — Confirm suspended-org block works on task and project routes, not just the org middleware unit

**State:** PROPOSED
**Depends on:** #187

---

# Confirm suspended-org block works on task and project routes, not just the org middleware unit

## What & Why
Task #187 adds middleware-level integration tests that confirm requireOrgOrApiKey returns 403
when isDisabled is true. The next gap is verifying this block is visible end-to-end on routes
that matter most to users — specifically GET /api/tasks and GET /api/projects — so a future
refactor that changes which middleware those routers use cannot silently remove the protection.

## Done looks like
- Extend artifacts/api-server/src/routes/orgs-suspended.test.ts (or add a new file)
- Mount the real tasks and projects routers (with requireOrgOrApiKey NOT mocked)
- Prime the DB mock to return isDisabled: true on the membership/org row
- Assert 403 org_suspended on at least GET /api/tasks and GET /api/projects

## Relevant files
- `artifacts/api-server/src/routes/orgs-suspended.test.ts` — existing suspension tests
- `artifacts/api-server/src/routes/tasks.ts` — uses requireOrgOrApiKey
- `artifacts/api-server/src/routes/projects.ts` — uses requireOrgOrApiKey
- `artifacts/api-server/src/middlewares/requireOrgMiddleware.ts` — isDisabled check
