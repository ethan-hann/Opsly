# #234 — Confirm manage_org_settings permission gates the org rename and settings routes the same way

**State:** PROPOSED
**Depends on:** #190

---

# Confirm manage_org_settings permission gates the org rename and settings routes

## What & Why
Task #190 added body-injection tests for manage_members routes, using the real
requirePermission middleware. The same pattern hasn't been applied to manage_org_settings:
PATCH /orgs/me is gated by requirePermission('manage_org_settings'), but there is no test
that sends a body with elevated fields (e.g. { isDisabled: false }) and confirms 403 fires
from the server-side permission check rather than body content.

## Done looks like
- Add a new describe block (or extend orgs-member-permissions.test.ts) following the same
  importOriginal pattern so the real requirePermission runs
- Set manage_org_settings: false in req.orgPermissions
- PATCH /api/orgs/me with { name: 'Hijacked', isDisabled: false } → 403
- Error body cites manage_org_settings, not any body field

## Relevant files
- `artifacts/api-server/src/routes/orgs-member-permissions.test.ts` — extend this file
- `artifacts/api-server/src/routes/orgs.ts` — PATCH /orgs/me handler (line ~216)
- `artifacts/api-server/src/middlewares/requireOrgMiddleware.ts` — requirePermission
