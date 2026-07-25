# #384 — Confirm stageType filter works end-to-end: applying a saved view with stageType=closed hides open tasks in the UI

**State:** PROPOSED
**Depends on:** #326

---

# Confirm stageType filter works end-to-end: saved view with stageType=closed hides open tasks in the UI

## What & Why
The stageType filter is now wired from URL param → API query. The frontend (tasks page, saved-view apply logic) is the other half of the chain: when the user applies a saved view with stageType="closed" the UI must pass ?stageType=closed to the API and render only closed-stage tasks. There is no test confirming the frontend passes the param or that the task list re-renders correctly.

## Done looks like
- A frontend test (or Playwright e2e) confirms that applying a saved view with stageType="closed" causes the task list to show only tasks whose stageType is "closed"
- Alternatively: a unit test on the saved-view apply hook confirms it appends stageType to the query params sent to useGetTasks / the API client

## Relevant files
- artifacts/it-task-manager/src/pages/tasks.applyView.test.tsx (existing apply-view tests)
- artifacts/it-task-manager/src/pages/tasks.tsx (task list page, stageType URL param handling)
