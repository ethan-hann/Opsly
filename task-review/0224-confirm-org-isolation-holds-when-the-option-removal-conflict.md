# #224 — Confirm org isolation holds when the option-removal conflict check runs against a cross-org field

**State:** PROPOSED
**Depends on:** #102

---

# Confirm org isolation holds when the option-removal conflict check runs against a cross-org field

## What & Why
The PATCH /custom-fields/:id handler has two separate database queries that must both enforce orgId:
1. The `currentDef` lookup in the option-removal conflict guard (WHERE id = ? AND orgId = ?)
2. The final UPDATE (WHERE id = ? AND orgId = ?)

Task #102 added an explicit cross-org test for the final UPDATE path (name-only rename). The option-removal conflict guard path — where a caller from org-a sends an `options` array targeting a field that belongs to org-b — also deserves its own explicit test showing that the `currentDef` lookup returns nothing and the handler still returns 404.

## Done looks like
- A test in the "PATCH /api/custom-fields/:id — option removal conflict guard" describe block that:
  - Sets `mockState.orgId = "org-a"`
  - Pushes an empty `selectQueue` entry (simulating currentDef not found for org-a)
  - Pushes an empty `updateResult` (simulating the final UPDATE matching no rows)
  - Sends a PATCH with an `options` array
  - Expects 404

## Relevant files
- `artifacts/api-server/src/routes/custom-fields.test.ts` (option removal conflict guard describe block, ~line 412)
- `artifacts/api-server/src/routes/custom-fields.ts` (PATCH handler, currentDef lookup ~line 124)
