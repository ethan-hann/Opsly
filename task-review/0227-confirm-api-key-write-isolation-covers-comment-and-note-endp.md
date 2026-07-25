# #227 — Confirm API key write isolation covers comment and note endpoints

**State:** PROPOSED
**Depends on:** #188

---

# Confirm API key write isolation covers comment and note endpoints

## What & Why
Tasks #171 and #188 added API key write isolation tests for task and project endpoints.
Comment and note write routes (POST /api/tasks/:id/comments, DELETE /api/tasks/:id/comments/:cid,
POST /api/notes, PATCH /api/notes/:id, DELETE /api/notes/:id) are also scoped by req.orgId
but have no isolation tests yet. A future change that breaks org scoping on these routes
would not be caught until runtime.

## Done looks like
- Extend artifacts/api-server/src/routes/api-key-isolation.test.ts
- At minimum: POST comment on an org-b task ID → 404; DELETE org-b comment → 404;
  DELETE org-b note → 404
- Follow the existing pattern: empty selectQueue or deleteResult → route short-circuits
  with 404 before touching another org's data

## Relevant files
- `artifacts/api-server/src/routes/api-key-isolation.test.ts` — extend this file
- `artifacts/api-server/src/routes/tasks.ts` — comment endpoints
- `artifacts/api-server/src/routes/notes.ts` — note endpoints
