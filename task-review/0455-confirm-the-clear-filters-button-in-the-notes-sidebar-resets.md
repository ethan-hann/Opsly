# #455 — Confirm the clear-filters button in the notes sidebar resets both filters at once

**State:** PROPOSED
**Depends on:** #450

---

# Confirm the clear-filters button in the notes sidebar resets both filters at once

## What & Why
When either the project or task filter is active, an X button appears next to the task filter combobox. Clicking it calls `setFilterProjectId("all"); setFilterTaskId("all")` — but there are no automated tests covering this path. A regression could leave one filter stuck after a "clear" action, silently hiding notes.

## Done looks like
- A test selects a project filter and a task filter, then clicks the X (clear-filters) button.
- Asserts both comboboxes reset to their "all" placeholder text after the click.

## Relevant files
- `artifacts/it-task-manager/src/pages/notes.tsx` — clear filters button (lines ~572-580), `filtersActive` flag (line ~138)
- `artifacts/it-task-manager/src/pages/notes.taskfilter.test.tsx` — existing mock scaffolding to reuse
