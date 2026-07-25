# #440 — Confirm org names and task titles are HTML-safe in webhook notification payloads

**State:** PROPOSED
**Depends on:** #436

---

# Confirm org names and task titles are HTML-safe in webhook notification payloads

## What & Why
Email templates now escape user-supplied strings. Webhook payloads sent to external systems (e.g. `task.created`, `comment.created`) also embed user-supplied fields like task title, assignee name, and org name in their JSON bodies — and some receivers render those fields as HTML. While JSON doesn't need HTML escaping by nature, webhook *message* fields (e.g. notification `message` strings like "Alice assigned you to \"Fix <prod>\""') may already be HTML-escaped from notifications.ts and then double-encoded, or not escaped at all. Confirm the behaviour is intentional and consistent.

## Done looks like
- Audit `artifacts/api-server/src/routes/webhooks.ts` and `lib/notifications.ts` for any field that embeds free-text user content in a webhook `message` string.
- Confirm whether those strings are HTML-escaped or plain text (and document the decision).
- Add a test that a webhook payload containing a task titled `<b>XSS</b>` either (a) delivers the plain-text title unescaped (correct for JSON) or (b) escapes it consistently — whichever the intended contract is.

## Relevant files
- `artifacts/api-server/src/lib/notifications.ts`
- `artifacts/api-server/src/routes/webhooks.ts` (or equivalent webhook delivery code)
