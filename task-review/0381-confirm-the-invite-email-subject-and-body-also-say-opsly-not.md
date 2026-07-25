# #381 — Confirm the invite email subject and body also say Opsly, not IT Task Manager

**State:** PROPOSED
**Depends on:** #321

---

# Confirm the invite email subject and body also say Opsly, not IT Task Manager

## What & Why
The SMTP test email branding is now verified by CI. The member invite email (built by buildInviteEmail in lib/email.ts) is a second customer-visible surface that could silently revert to a generic product name. Task #320 already added a subject-line assertion for it, but there is no assertion on the HTML body text confirming "Opsly" appears there too.

## Done looks like
- The existing buildInviteEmail test (or a new one) asserts the HTML body contains "Opsly"
- The test also asserts the body does NOT contain "IT Task Manager"

## Relevant files
- artifacts/api-server/src/lib/email.ts (buildInviteEmail)
- artifacts/api-server/src/routes/orgs.test.ts (POST /orgs/invite describe block)
