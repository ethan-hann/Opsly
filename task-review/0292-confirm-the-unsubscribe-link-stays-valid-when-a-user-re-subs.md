# #292 — Confirm the unsubscribe link stays valid when a user re-subscribes and unsubscribes again

**State:** PROPOSED
**Depends on:** #174

---

# Confirm the unsubscribe link stays valid when a user re-subscribes and unsubscribes again

## What & Why
The one-click unsubscribe token is generated per digest email send and is valid for 30 days. There's no test covering the re-subscribe → re-unsubscribe flow: a user opts back in via settings, receives a new digest with a new token, then clicks unsubscribe again. The token utility and route should handle this correctly, but it hasn't been verified in a live-database integration test.

## Done looks like
- A live-DB test (or extended unit test) covering: unsubscribe → re-subscribe (PATCH /api/email-digest-preference) → unsubscribe again via a freshly generated token
- Confirms frequency is "none" at the end and that the old token from before re-subscribe still works (it's not invalidated by re-subscribing)

## Relevant files
- `artifacts/api-server/src/routes/unsubscribe.ts`
- `artifacts/api-server/src/routes/unsubscribe.test.ts`
- `artifacts/api-server/src/lib/unsubscribe-token.ts`
- `artifacts/api-server/src/routes/notifications.ts` (email-digest-preference PATCH endpoint)
