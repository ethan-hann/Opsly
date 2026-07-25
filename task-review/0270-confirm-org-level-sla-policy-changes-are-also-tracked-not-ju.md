# #270 — Confirm org-level SLA policy changes are also tracked (not just project overrides)

**State:** PROPOSED
**Depends on:** #136

---

# Confirm org-level SLA policy changes are also tracked (not just project overrides)

## What & Why
Audit logging was added to PUT /projects/:id/sla-policies (project-level overrides). The org-level SLA endpoint (PUT /org/sla-policies) has the same silent-replacement problem — a breach with no record of who set the org defaults is equally invisible.

## Done looks like
- PUT /org/sla-policies inserts a row into an equivalent audit table capturing actor, timestamp, previousPolicies, newPolicies
- A test confirms the audit record is written on a successful org-level SLA update
- A test confirms no audit record is written if the request is rejected (e.g. bad input or missing permission)

## Relevant files
- `artifacts/api-server/src/routes/` — find the org SLA handler
- `lib/db/src/schema/project-sla-audit.ts` — extend or create a parallel org-level audit schema
