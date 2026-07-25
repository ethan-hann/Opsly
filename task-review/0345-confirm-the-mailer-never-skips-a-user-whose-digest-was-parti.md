# #345 — Confirm the mailer never skips a user whose digest was partially sent before a process crash

**State:** PROPOSED
**Depends on:** #294

---

# Confirm the mailer never skips a user whose digest was partially sent before a process crash

## What & Why
The stale-claim TTL guards against a crashed process, but the recovery only fires on the next mailer run (up to 1 hour later). A live-DB integration test that seeds multiple users — some with stale claims, some mid-send — would confirm the full recovery path works end-to-end with a real database, not just mocked selects.

## Done looks like
- A live-DB spec inserts multiple preference rows: one with a stale claim, one with a fresh claim, one with no claim
- Calls runDigest (or equivalent) directly against the test database
- Confirms only the stale-claimed and unclaimed rows produce sends, and that fresh-claimed rows are untouched

## Relevant files
- `artifacts/api-server/src/lib/digest-mailer.ts`
- `artifacts/api-server/src/lib/digest-mailer.test.ts`
- `lib/db/src/schema/email-digest.ts`
