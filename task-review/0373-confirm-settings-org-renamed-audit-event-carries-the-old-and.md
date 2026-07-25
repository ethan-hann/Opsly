# #373 — Confirm settings.org_renamed audit event carries the old and new name in its metadata

**State:** PROPOSED
**Depends on:** #324

---

# Confirm settings.org_renamed audit event carries the old and new name in its metadata

## What & Why
PATCH /orgs/me (rename) fires logOrgEvent with action 'settings.org_renamed' and metadata { from: oldName, to: newName }. The existing rename test in orgs.test.ts only asserts res.status < 500. There is no assertion on the logOrgEvent payload's metadata field, so a regression that drops the old name or swaps from/to would go undetected.

## Done looks like
- The existing audit-events describe block (artifacts/api-server/src/routes/audit-events.test.ts) or orgs.test.ts gains a test for PATCH /orgs/me
- Test asserts logOrgEvent is called with action='settings.org_renamed', category='settings', metadata.from='Old Corp', metadata.to='New Corp'

## Relevant files
- artifacts/api-server/src/routes/orgs.ts (PATCH /orgs/me handler ~line 259)
- artifacts/api-server/src/routes/audit-events.test.ts
