# #261 — Show a warning indicator on tasks approaching their SLA deadline

**State:** PROPOSED
**Depends on:** #121

---

# Show a warning indicator on tasks approaching their SLA deadline

## What & Why
Admins can now set a custom warning threshold percent per priority. The backend already fires a warning webhook when this threshold is crossed (`warningThresholdPercent`), but the task list and task detail pages have no visual indicator that a task is in the warning zone (past the threshold but not yet breached). Surfacing this in the UI would let teams act before the SLA is missed.

## Done looks like
- Tasks in the warning zone (past warningThresholdPercent of their SLA window, but not yet breached) show an amber/yellow indicator in the task list and task detail page
- The indicator tooltip or label explains "SLA warning — X% of deadline elapsed"
- The filter panel includes a "SLA Warning" filter alongside the existing "SLA Breached" filter

## Relevant files
- `artifacts/it-task-manager/src/pages/tasks.tsx` — task list
- `artifacts/it-task-manager/src/pages/task-detail.tsx` — task detail
- `artifacts/api-server/src/routes/tasks.ts` — may need to expose slaWarningAt or a computed flag
