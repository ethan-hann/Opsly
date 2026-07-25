# #375 — Confirm 'Reset color' leaves the logo intact and 'Remove logo' leaves the color intact

**State:** PROPOSED
**Depends on:** #318

---

# Confirm 'Reset color' leaves the logo intact and 'Remove logo' leaves the color intact

## What & Why
Task 318 split the single "Clear branding" button into two independent buttons. Without a test, a future change could accidentally regress independent clearing back to clearing both fields at once.

## Done looks like
- A test for PATCH /orgs/me/branding sends { primaryColor: null } and asserts logoUrl is unchanged in the DB
- A test sends { logoUrl: null } and asserts primaryColor is unchanged in the DB

## Relevant files
- `artifacts/api-server/src/routes/orgs.ts` (PATCH /orgs/me/branding handler)
- `artifacts/api-server/src/routes/orgs.test.ts` (if it exists) or the nearest branding test file
