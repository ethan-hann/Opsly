# #366 — Confirm other startup checks (e.g. SMTP config) also survive boot errors without crashing

**State:** PROPOSED
**Depends on:** #342

---

# Confirm other startup checks also survive boot errors without crashing

## What & Why
warnIfNoAdminConfigured is now verified to swallow DB errors safely. If other startup-time checks are added in the future (e.g. SMTP reachability, license validation) they should follow the same pattern. A regression guide or a shared test utility for this pattern would make the guarantee easy to verify for new checks.

## Done looks like
- Any future startup check in artifacts/api-server/src/lib/startup-checks.ts has a corresponding test confirming it resolves even when its external dependency rejects
- Optionally, a shared test helper (e.g. assertStartupCheckIsSafe) reduces boilerplate for adding more checks

## Relevant files
- artifacts/api-server/src/lib/startup-checks.ts
- artifacts/api-server/src/lib/startup-checks.test.ts
