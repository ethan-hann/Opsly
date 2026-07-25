# #217 — Fire member.removed when an org is transferred and the previous owner is demoted

**State:** PROPOSED
**Depends on:** #77

---

# Fire member.removed when an org is transferred and the previous owner is demoted

## What & Why
Ownership transfer (PATCH /orgs/members/:userId/role to the Owner role) atomically promotes the target and demotes the acting owner to Admin. The acting owner effectively changes role, but no member.removed webhook fires for the demotion, and no separate notification is sent. External integrations tracking membership status (CMDBs, PagerDuty, Slack bots) won't know the former owner's access level changed.

## Done looks like
- The ownership-transfer path in PATCH /orgs/members/:userId/role calls dispatchMemberRemoved (or a new dispatchMemberRoleChanged) for the demoted owner
- Route-level tests verify the dispatch is called during ownership transfer
- Tests confirm dispatch is NOT called when role change is not an ownership transfer

## Relevant files
- `artifacts/api-server/src/routes/orgs.ts` (PATCH /orgs/members/:userId/role ~line 638)
- `artifacts/api-server/src/lib/webhook-dispatcher.ts`
