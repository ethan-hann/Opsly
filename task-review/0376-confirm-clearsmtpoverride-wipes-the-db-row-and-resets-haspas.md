# #376 — Confirm clearSmtpOverride wipes the DB row and resets hasPassword to false in the status response

**State:** PROPOSED
**Depends on:** #315

---

# Confirm clearSmtpOverride wipes the DB row and resets hasPassword to false

## What & Why
DELETE /api/admin/email/config calls clearSmtpOverride() to remove the stored credential. There is no test confirming the status endpoint subsequently reports hasPassword: false. A bug where the DB row isn't deleted, or where getEmailConfig still reads a stale encrypted value, would leave hasPassword: true indefinitely.

## Done looks like
- artifacts/api-server/src/routes/admin-smtp-security.test.ts gains a test for DELETE /api/admin/email/config
- After the delete, getEmailConfig mock returns hasPassword: false
- Test asserts the response has hasPassword: false and no pass field

## Relevant files
- artifacts/api-server/src/routes/admin.ts (DELETE /admin/email/config handler)
- artifacts/api-server/src/routes/admin-smtp-security.test.ts
