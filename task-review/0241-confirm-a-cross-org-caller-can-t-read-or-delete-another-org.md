# #241 — Confirm a cross-org caller can't read or delete another org's task template by guessing its ID

**State:** PROPOSED
**Depends on:** #113

---

# Confirm task template cross-org write isolation holds at the DB level

## What & Why
Task #113 added DB-level isolation tests for GET /api/task-templates, confirming that
the WHERE orgId clause filters correctly. The complementary risk — an Org A caller
guessing an Org B template ID and issuing PATCH or DELETE — is not yet covered in the
live-DB suite. The mock-based tests in isolation.test.ts cover the route logic, but a
missing or misordered WHERE clause at the SQL level would only be caught by a real-DB
test.

## Done looks like
- isolation-db.test.ts: "DB isolation — PATCH /api/task-templates/:id"
  → 404 for an Org B template id; DB row name unchanged
- isolation-db.test.ts: "DB isolation — DELETE /api/task-templates/:id"
  → 404 for an Org B template id; DB row still present after the request

## Relevant files
- `artifacts/api-server/src/routes/isolation-db.test.ts` — append after the GET block
- `artifacts/api-server/src/routes/task-templates.ts` — PATCH/DELETE handlers (lines 73–141)
