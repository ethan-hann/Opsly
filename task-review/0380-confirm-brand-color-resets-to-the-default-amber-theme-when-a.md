# #380 — Confirm brand color resets to the default amber theme when an org clears its primaryColor via the API

**State:** PROPOSED
**Depends on:** #317

---

# Confirm brand color resets to the default amber theme when an org clears its primaryColor via the API

## What & Why
The BrandingProvider correctly removes its style tag when primaryColor becomes null. However there is no test that exercises the full round-trip: an admin PATCHes primaryColor to null via the API, the GET /orgs/me response confirms null, and the frontend then clears CSS variables. The existing tests cover each layer in isolation but not the end-to-end clear path, so a regression in how the API serializes null could silently break the reset flow.

## Done looks like
- A test (or extended branding-context test) renders BrandingProvider with an initial non-null color, then simulates the API returning primaryColor: null after a reset PATCH
- Asserts the style tag is removed and the context exposes null (no stale color)
- Optionally verifies the amber fallback variables are active (or simply that the custom tag is absent)

## Relevant files
- artifacts/it-task-manager/src/context/branding-context.test.tsx
- artifacts/api-server/src/routes/orgs.test.ts (PATCH /orgs/me/branding — #317 describe block)
