# #251 — Extend the view_audit_log guard to the live-DB isolation suite

**State:** PROPOSED
**Depends on:** #130

---

# Live-DB isolation test for view_audit_log permission guard

## What & Why
Task #130 added a unit test confirming that GET /tasks/:id/events returns 403
when the caller lacks view_audit_log. The live-DB suite (isolation-db.test.ts)
tests org boundary enforcement with real queries but does not cover permission
gating. A regression that accidentally removed the hasPermission check would
not be caught by the live-DB suite.

## Done looks like
- In isolation-db.test.ts, add a describeIf block:
  "GET /api/tasks/:id/events — view_audit_log permission gate"
  · "returns 403 when orgPermissions.view_audit_log is false" — set the mock
    middleware to emit view_audit_log: false; assert res.status === 403
  · "returns 200 when orgPermissions.view_audit_log is true (sanity check)" —
    assert res.status === 200 using orgATaskId

## Relevant files
- artifacts/api-server/src/routes/isolation-db.test.ts
- artifacts/api-server/src/routes/tasks.ts (guard added in task #130)
