# #219 — Prevent SLA overshoot numbers from being under-reported when a project has a stricter policy than the org default

**State:** PROPOSED
**Depends on:** #207

---

# Fix avgBreachMinutes to use project-level SLA thresholds when computing overshoot

## What & Why
The `GET /dashboard/sla-summary` breach query LEFT JOINs only org-level SLA policies (projectId IS NULL) to compute `avgBreachMinutes`. When a task's breach was detected against a project-level override that is stricter than the org policy (e.g. 30-min project override vs 60-min org policy), the overshoot is computed against the 60-min threshold and then clamped to 0 by GREATEST(..., 0). This means the dashboard shows 0 min (or no average) instead of the real overshoot, hiding breach severity for projects with tighter SLAs.

`breachedCount` and `complianceRate` are always correct because `slaBreachedAt` is the source of truth. Only `avgBreachMinutes` is affected.

The limitation is documented in a comment in `dashboard.ts` and in the test file's project-level override describe block.

## Done looks like
- The breach query uses Drizzle `alias()` to join `sla_policies` twice: once for the project-level override (matching `tasks.project_id`), once for the org-level fallback (project_id IS NULL)
- The threshold expression uses COALESCE(project_minutes, org_minutes) so the correct target is subtracted
- A live-DB test confirms that a task breached at 31 min against a 30-min project override (org policy 60 min) reports a non-zero overshoot
- The documentation comment in `dashboard.ts` is updated to reflect the fix

## Relevant files
- `artifacts/api-server/src/routes/dashboard.ts` — breach query (~line 288), NOTE comment above it
- `artifacts/api-server/src/routes/dashboard.test.ts` — project-level override comment block (near end of file)
