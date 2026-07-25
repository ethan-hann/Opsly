# #417 — Remember the last active tab per project so it reopens where you left off

**State:** PROPOSED
**Depends on:** #405

---

# Remember the last active tab per project so it reopens where you left off

## What & Why
Currently the active tab always resets to "tasks" whenever the user switches into tabbed mode. Users who habitually work in the Notes or SLA tab have to re-navigate every visit. Persisting the active tab per project (keyed by project ID) makes the tabbed layout feel polished.

## Done looks like
- Active tab is stored in `localStorage` under a key like `project-detail-active-tab-<projectId>`
- On mount in tabbed mode the page reopens on the last-visited tab
- Falls back to "tasks" if no stored value exists

## Relevant files
- `artifacts/it-task-manager/src/pages/project-detail.tsx` — `activeTab` state and the `layoutMode === "tabbed"` branch
