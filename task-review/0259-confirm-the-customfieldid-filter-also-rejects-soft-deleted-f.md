# #259 — Confirm the customFieldId filter also rejects soft-deleted fields (deletedAt IS NOT NULL)

**State:** PROPOSED
**Depends on:** #240

---

# Test that the custom field filter rejects deleted fields

## What & Why
The customFieldId guard uses WHERE id = :id AND orgId = :orgId AND deletedAt IS NULL.
Task #240 added a cross-org test (field not found → 400). The deletedAt IS NULL
clause is equally important: a caller who remembers a field's numeric ID after it was
purged must also get a 400, not a task list filtered on a stale field. This is not
currently tested.

## Done looks like
- In tasks.test.ts (GET /api/tasks describe block), add one test:
  · "returns 400 when customFieldId refers to a soft-deleted field" —
    selectQueue pushes [] to simulate the field lookup returning nothing
    (deletedAt IS NOT NULL → filtered out), assert 400 + "Custom field not found"

## Relevant files
- artifacts/api-server/src/routes/tasks.ts — customFieldId guard (~line 428-439)
- artifacts/api-server/src/routes/tasks.test.ts — GET /api/tasks describe block
