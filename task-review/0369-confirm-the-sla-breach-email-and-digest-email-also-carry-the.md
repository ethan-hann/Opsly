# #369 — Confirm the SLA breach email and digest email also carry the Opsly brand in header and footer

**State:** PROPOSED
**Depends on:** #320

---

# Confirm the SLA breach email and digest email also carry the Opsly brand in header and footer

## What & Why
buildInviteEmail now has branding coverage, but buildSlaBreachEmail and buildDigestEmail in artifacts/api-server/src/lib/email.ts are not yet tested. A branding regression in either would silently ship unbranded or broken emails to users without any test catching it.

## Done looks like
- Unit tests for buildSlaBreachEmail confirm "Opsly" appears in the header and footer
- Unit tests for buildDigestEmail confirm "Opsly" appears in the header and footer
- Tests live in artifacts/api-server/src/lib/email.test.ts alongside the existing buildInviteEmail tests

## Relevant files
- artifacts/api-server/src/lib/email.ts (buildSlaBreachEmail, buildDigestEmail)
- artifacts/api-server/src/lib/email.test.ts
