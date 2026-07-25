# #260 — Confirm saving a warning threshold outside 1–99 is rejected cleanly

**State:** PROPOSED
**Depends on:** #121

---

# Confirm saving a warning threshold outside 1–99 is rejected cleanly

## What & Why
The SLA policy editor now sends `warningThresholdPercent` to the backend. The backend validates 1–99 via zod, but there's no automated test confirming that out-of-range values (0, 100, -1, non-integers) are rejected with a 400, not silently accepted or stored.

## Done looks like
- A test in `artifacts/api-server/src/routes/` (orgs and projects SLA routes) sends warningThresholdPercent = 0, 100, and -1 and asserts 400
- A test sends warningThresholdPercent = 1 and 99 and asserts they are accepted
- Tests live alongside the existing SLA route tests

## Relevant files
- `artifacts/api-server/src/routes/orgs.ts` — PUT /org/sla-policies
- `artifacts/api-server/src/routes/projects.ts` — PUT /projects/:id/sla-policies
