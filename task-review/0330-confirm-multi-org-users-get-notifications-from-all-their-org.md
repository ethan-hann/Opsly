# #330 — Confirm multi-org users get notifications from all their orgs bundled in one digest

**State:** PROPOSED
**Depends on:** #295

---

# Confirm multi-org users get notifications from all their orgs bundled in one digest

## What & Why
The mailer is designed to aggregate unread notifications across ALL orgs a user belongs to, grouped by org. There is currently no test that exercises the multi-org path: a user in two orgs with notifications in both should receive one email covering both orgs, not two separate emails or a silent skip of the second org.

## Done looks like
- A test with a user in two orgs (`org1`, `org2`), each with unread notifications
- Confirms `sendMail` is called exactly once (not twice)
- Confirms the digest HTML includes notifications from both orgs

## Relevant files
- `artifacts/api-server/src/lib/digest-mailer.test.ts` — add a new test in the existing describe block
- `artifacts/api-server/src/lib/digest-mailer.ts` — multi-org aggregation logic (membershipsByUser map, per-user loop)
