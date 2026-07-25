# #229 — Confirm workflow stage cross-org isolation holds against a real database, not just mocks

**State:** PROPOSED
**Depends on:** #103

---

# Confirm workflow stage cross-org isolation holds against a real database, not just mocks

## What & Why
The existing isolation tests (workflow-stages.isolation.test.ts) mock the database layer, so they verify route logic but not the actual SQL WHERE clauses. A real-database test would confirm that the `AND orgId = ?` filter in the drizzle queries actually prevents cross-org reads and writes at the SQL level, catching any drift if the queries are refactored.

## Done looks like
- Integration tests using a real (test) PostgreSQL instance that:
  - Insert stages for org-b directly into the DB
  - Authenticate as org-a and confirm GET /workflow-stages never returns org-b's rows
  - Confirm PATCH/DELETE on org-b stage IDs return 404 at the DB level (not just the mock)
  - Confirm reassignTo=<org-b stage id> on DELETE is rejected with 400

## Relevant files
- `artifacts/api-server/src/routes/workflow-stages.isolation.test.ts`
- `artifacts/api-server/src/routes/isolation-db.test.ts` (existing DB-level isolation test pattern to follow)
- `artifacts/api-server/src/routes/workflow-stages.ts`
