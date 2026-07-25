# #236 — Confirm the purge audit trail survives when the field was already soft-deleted before purge

**State:** PROPOSED
**Depends on:** #107

---

# Confirm the purge audit trail survives when the field was already soft-deleted before purge

## What & Why
The purge endpoint accepts both active and soft-deleted fields. The audit-trail logic added in the purge handler is tested against active fields, but a soft-deleted field still holds a name that must appear correctly in the audit events. This edge case isn't currently covered by a test.

## Done looks like
- A test in the purge describe block in `artifacts/api-server/src/routes/custom-fields.test.ts` asserts that audit events are written with the correct field name when the purged definition has a non-null deletedAt
- The test confirms that `insertCalls[0][0].field` matches `cf:<name>` even for a soft-deleted field
