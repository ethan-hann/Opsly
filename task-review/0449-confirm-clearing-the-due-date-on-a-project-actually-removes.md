# #449 — Confirm clearing the due date on a project actually removes it rather than leaving the old date

**State:** PROPOSED
**Depends on:** #445

---

# Confirm clearing the due date on a project actually removes it rather than leaving the old date

## What & Why
The project-properties-panel tests stub out InlineDueDatePicker, so the "clear due date → sends null to PATCH" path has no automated coverage. A regression here would leave stale due dates in the UI and database silently.

## Done looks like
- A test renders ProjectPropertiesPanel with a project that has a non-null dueDate.
- The test simulates clicking the clear button inside InlineDueDatePicker (either by rendering the real component or by driving the onChange callback directly).
- The test asserts updateProject is called with `{ dueDate: null }`.
- A second assertion confirms the displayed date text is replaced by the "no date" placeholder when the query re-renders with dueDate: null.

## Relevant files
- `artifacts/it-task-manager/src/components/ui/project-properties-panel.tsx`
- `artifacts/it-task-manager/src/components/ui/property-panel.tsx` — InlineDueDatePicker (clear button logic)
- `artifacts/it-task-manager/src/components/ui/project-properties-panel.test.tsx` — existing test file to extend
