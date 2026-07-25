# #452 — Confirm the Owner row appears and hides correctly across all three project property scenarios

**State:** PROPOSED
**Depends on:** #447

---

# Confirm the Owner row appears and hides correctly across all three property scenarios

## What & Why
The Owner PropertyRow in the project properties panel is conditionally rendered based on `project.createdByName`. Three scenarios need coverage: (1) a session-authenticated creator whose name is shown, (2) a project created via API key where `createdByName` is null and the row is hidden, (3) a project created before the column was added (also null).

Currently there are no frontend component tests for `ProjectPropertiesPanel`, so regressions in this conditional logic would go undetected.

## Done looks like
- A Vitest/React Testing Library test renders `ProjectPropertiesPanel` with each of the three scenarios.
- Asserts the Owner row is present when `createdByName` is a non-empty string.
- Asserts the Owner row is absent when `createdByName` is null or undefined.

## Relevant files
- `artifacts/it-task-manager/src/components/ui/project-properties-panel.tsx`
