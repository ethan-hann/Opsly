# #434 — Confirm @[everyone] chips don't appear in comments from orgs with no broadcast permission

**State:** PROPOSED
**Depends on:** #423

---

# Confirm @[everyone] chips don't appear in comments from orgs with no broadcast permission

## What & Why
preprocessMentions() always renders @[everyone] as a chip regardless of the org's feature flags or the commenter's permissions. If broadcast mentions are gated (e.g. admins only), a regular user who hand-crafts @[everyone] in their comment body would still see it rendered as a chip — and recipients would still get notified. There is currently no client-side guard and no test confirming the behaviour when the feature is off.

## Done looks like
- Confirm whether @[everyone] mention creation is blocked server-side when the user lacks the broadcast permission.
- If not, add a server-side guard in the comment creation route.
- Add a test that a comment stored with an @[everyone] token from an unpermitted user does not trigger fan-out notifications.

## Relevant files
- `artifacts/api-server/src/routes/comments.ts` — comment creation route
- `artifacts/it-task-manager/src/lib/comment-utils.ts` — preprocessMentions (client render)
