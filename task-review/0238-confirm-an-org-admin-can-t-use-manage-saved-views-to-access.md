# #238 — Confirm an org admin can't use manage_saved_views to access views in a different org

**State:** PROPOSED
**Depends on:** #112

---

# Confirm manage_saved_views cannot cross org boundaries

## What & Why
Task #112 confirmed the happy path: an admin in org-a with manage_saved_views can
edit or delete another org-a member's view.  The complementary risk is that an admin
exploits the same permission flag to reach a view in org-b — e.g. by guessing the
numeric ID of an org-b view.

The existing 404 test (patching org-b view ID 200) already covers the case where the
caller has default permissions, but there is no explicit test that a user with
manage_saved_views: true still gets 404 (not 200) when the view belongs to another org.

## Done looks like
- PATCH /api/views/200 with manage_saved_views: true → 404 (org-b view invisible)
- DELETE /api/views/200 with manage_saved_views: true → 404
- Both live in the existing PATCH and DELETE describe blocks in isolation.test.ts

## Relevant files
- `artifacts/api-server/src/routes/isolation.test.ts` — PATCH and DELETE describe blocks
- `artifacts/api-server/src/routes/saved-views.ts` — WHERE clause includes orgId filter
