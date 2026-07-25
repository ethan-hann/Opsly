# #402 — Confirm project description markdown saves and re-renders correctly end-to-end

**State:** PROPOSED
**Depends on:** #401

---

# Confirm project description markdown saves and re-renders correctly end-to-end

## What & Why
The project description field now uses a markdown editor in both New Project and Edit Project modals, and the project detail page renders it as formatted markdown. There are no automated tests confirming that:
- Markdown entered in the editor (bold, lists, headings) is stored as-is and returned by the API
- The project detail page renders the markdown (not raw syntax) after save
- Clearing the description saves it as null/undefined rather than an empty string

## Done looks like
- A test opens the New Project modal, enters markdown text, saves, and confirms the detail page shows rendered HTML (not raw `**bold**`)
- A test opens Edit Project, clears the description, saves, and confirms the description section is hidden on the detail page
- Existing project create/update API tests verify the description field round-trips correctly

## Relevant files
- `artifacts/it-task-manager/src/components/ui/new-project-modal.tsx`
- `artifacts/it-task-manager/src/components/ui/edit-project-modal.tsx`
- `artifacts/it-task-manager/src/pages/project-detail.tsx`
