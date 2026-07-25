# #210 — Confirm workflow stage routes can't read or modify another org's stages in a live-database test

**State:** PROPOSED
**Depends on:** #203

---

# Confirm workflow stage routes can't read or modify another org's stages in a live-database test

## What & Why
Task #103 adds mock-based cross-org isolation tests for the workflow stage API. The live-database isolation suite (isolation-db.test.ts) now covers tasks, projects, notes, saved views, SLA overrides, and custom field definitions — but not workflow stages. A query-level bug (missing orgId clause) in GET /workflow-stages, PATCH /workflow-stages/:id, or DELETE /workflow-stages/:id would not be caught by mock-based tests.

## Done looks like
- isolation-db.test.ts seeds one workflow stage per org (in addition to the seeded "To Do" stage used by tasks)
- GET /api/workflow-stages returns only Org A stages, not Org B stages
- PATCH /api/workflow-stages/:id with Org B stage ID returns 404, DB row unchanged
- DELETE /api/workflow-stages/:id with Org B stage ID returns 404, DB row still present
- workflowStagesTable is already imported; workflowStagesRouter is added to buildApp(); zod schemas added to the api-zod passthrough mock

## Relevant files
- artifacts/api-server/src/routes/isolation-db.test.ts
- artifacts/api-server/src/routes/workflow-stages.ts
