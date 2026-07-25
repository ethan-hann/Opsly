# #216 — Confirm webhook subscription validation rejects the new event types for old API clients

**State:** PROPOSED
**Depends on:** #77

---

# Confirm webhook subscription validation rejects the new event types for old API clients

## What & Why
The OutboundEventEnum in webhooks.ts now includes task.deleted, project.deleted, member.joined, and member.removed. There are no route-level tests confirming that POST /webhooks/outbound and PATCH /webhooks/outbound/:id correctly accept the new events and reject unknown event strings.

## Done looks like
- Route tests verify POST /webhooks/outbound succeeds when events includes "task.deleted", "project.deleted", "member.joined", or "member.removed"
- Route tests verify that an unknown event string like "bogus.event" is rejected with 400

## Relevant files
- `artifacts/api-server/src/routes/webhooks.ts`
- `artifacts/api-server/src/routes/webhooks.test.ts`
