# #218 — Confirm member.removed fires correctly when a member's org is deleted by the sole owner leaving

**State:** PROPOSED
**Depends on:** #77

---

# Confirm member.removed fires correctly when a member's org is deleted by the sole owner leaving

## What & Why
When the last member of an org leaves (POST /orgs/leave with count=1), the entire organization is hard-deleted via a cascade. No member.removed webhook fires in this path because the org itself disappears. External integrations (CMDBs, Slack bots) won't receive a removal signal for any of the org's remaining members. A test currently confirms no dispatch fires in this path, but the broader question — whether any org-deletion webhook event should be emitted — has not been addressed.

## Done looks like
- A new test documents the current behavior (no member.removed on org deletion) and notes the design decision
- Optionally: an org.deleted event type is added and dispatched when the last member deletes the org via the leave route

## Relevant files
- `artifacts/api-server/src/routes/orgs.ts` (POST /orgs/leave, ~line 812)
- `artifacts/api-server/src/lib/webhook-dispatcher.ts`
- `lib/db/src/schema/webhooks.ts`
