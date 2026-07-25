# #248 — Show the Custom SLA badge on the project detail page so admins don't lose context after clicking in

**State:** PROPOSED
**Depends on:** #119

---

# Show the Custom SLA badge on the project detail page

## What & Why
The projects list now shows a "Custom SLA" badge on cards with overrides, but the badge disappears once an admin clicks into the project detail page. Carrying the indicator into the detail view provides consistent context and removes the need to scroll down to the SLA policies section to confirm whether overrides are active.

## Done looks like
- The project detail page header shows the same "Custom SLA" badge when `hasSlaOverrides` is true
- The badge links or scrolls to the SLA policies section for quick access
- No badge shown when the project uses org defaults

## Relevant files
- `artifacts/it-task-manager/src/pages/project-detail.tsx` — project detail page header area
- `artifacts/api-server/src/routes/projects.ts` — GET /projects/:id already returns `hasSlaOverrides` from `serializeProject`
