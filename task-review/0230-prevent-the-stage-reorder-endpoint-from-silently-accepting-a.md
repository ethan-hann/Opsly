# #230 — Prevent the stage reorder endpoint from silently accepting another org's stage IDs

**State:** PROPOSED
**Depends on:** #103

---

# Prevent the stage reorder endpoint from silently accepting another org's stage IDs

## What & Why
POST /workflow-stages/reorder currently accepts any list of IDs. Stage IDs from another org are silently no-op'd (the WHERE orgId filter means the UPDATE matches 0 rows), but the endpoint still returns 204. This means a caller can submit a mix of their own and another org's IDs without receiving an error, making mistakes hard to detect and masking potential enumeration probes.

## Done looks like
- After issuing the bulk UPDATE, the endpoint verifies that the number of updated rows equals the number of submitted IDs
- If they don't match, it returns 400 with "One or more stage IDs not found" (without leaking which IDs failed)
- Tests in workflow-stages.test.ts / workflow-stages.isolation.test.ts are updated accordingly

## Relevant files
- `artifacts/api-server/src/routes/workflow-stages.ts` (reorder handler ~line 94)
- `artifacts/api-server/src/routes/workflow-stages.isolation.test.ts`
