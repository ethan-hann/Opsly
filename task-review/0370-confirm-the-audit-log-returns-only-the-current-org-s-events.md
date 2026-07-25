# #370 — Confirm the audit log returns only the current org's events, never another org's

**State:** PROPOSED
**Depends on:** #323

---

# Confirm the audit log returns only the current org's events, never another org's

## What & Why
The GET /org/audit-log route filters by orgId, but there is no test confirming that rows belonging to a different org are excluded from the response. A mis-applied WHERE clause could silently leak cross-org audit data.

## Done looks like
- A test populates the mock select queue with two org-event rows: one for the caller's org and one for a different org
- The test asserts only the caller's org event appears in the response
- Uses the existing mock pattern in artifacts/api-server/src/routes/audit-log.test.ts

## Relevant files
- artifacts/api-server/src/routes/audit-log.ts
- artifacts/api-server/src/routes/audit-log.test.ts
