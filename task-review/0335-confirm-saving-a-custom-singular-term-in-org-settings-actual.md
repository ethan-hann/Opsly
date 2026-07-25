# #335 — Confirm saving a custom singular term in org settings actually changes the button labels

**State:** PROPOSED
**Depends on:** #302

---

# Confirm saving a custom singular term in org settings actually changes the button labels

## What & Why
An admin can now set e.g. `tasksSingular: "Ticket"` via the Terminology card. There is no automated check that this value flows through the API, into the `/orgs/me` response, and appears in the "New Ticket" button on the tasks page. Without a test, a future change to the context or the backend could silently break the end-to-end path.

## Done looks like
- A test PATCHes /orgs/terminology with { tasks: "Tickets", tasksSingular: "Ticket" }
- Verifies GET /orgs/me returns tasksSingular: "Ticket" in the terminology object
- A Playwright or component test confirms the tasks page button reads "New Ticket"

## Relevant files
- `artifacts/api-server/src/routes/orgs.ts` — PATCH /orgs/terminology
- `artifacts/it-task-manager/src/context/terminology-context.tsx` — ts() helper
- `artifacts/it-task-manager/src/pages/tasks.tsx` — "New {ts('tasks')}" button
