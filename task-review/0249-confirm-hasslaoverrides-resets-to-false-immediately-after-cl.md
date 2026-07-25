# #249 — Confirm hasSlaOverrides resets to false immediately after clearing all project SLA overrides

**State:** PROPOSED
**Depends on:** #119

---

# Confirm hasSlaOverrides resets to false after clearing overrides

## What & Why
The `hasSlaOverrides` flag is computed at query time via a subquery on `sla_policies`. If the UI calls PUT /projects/:id/sla-policies with an empty array (clearing overrides) and then re-fetches the project list, the badge should disappear. There's no live-DB test confirming this round-trip.

## Done looks like
- A test PUTs an empty policies array, then GETs /projects and asserts `hasSlaOverrides` is `false`
- A complementary test PUTs a non-empty policies array and asserts `hasSlaOverrides` is `true`

## Relevant files
- `artifacts/api-server/src/routes/projects.test.ts` — add integration-style tests for the SLA override flag
- `artifacts/api-server/src/routes/projects.ts` — GET /projects handler with the subquery
