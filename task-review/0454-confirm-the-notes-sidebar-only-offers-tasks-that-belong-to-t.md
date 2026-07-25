# #454 — Confirm the notes sidebar only offers tasks that belong to the selected project

**State:** PROPOSED
**Depends on:** #450

---

# Confirm the notes sidebar only offers tasks that belong to the selected project

## What & Why
The sidebar derives `filteredTasksForSidebar` by narrowing the full task list to the selected project's tasks and passes it as the `options` prop of the task SearchableSelect. There is no automated assertion that the dropdown actually hides tasks from other projects, so a regression (e.g. the filter accidentally becoming project-agnostic) would be invisible until a user notices stale options.

## Done looks like
- A test selects a project filter and asserts the task dropdown only contains tasks that belong to that project.
- A second assertion confirms switching to "All Projects" restores the full task list in the dropdown.

## Relevant files
- `artifacts/it-task-manager/src/pages/notes.tsx` — `filteredTasksForSidebar` derivation (lines ~143-146)
- `artifacts/it-task-manager/src/pages/notes.taskfilter.test.tsx` — existing mock scaffolding to reuse
