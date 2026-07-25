# #415 — Extend heading anchor links to task description and project description views

**State:** PROPOSED
**Depends on:** #410

---

# Extend heading anchor links to task description and project description views

## What & Why
The note viewer now shows copy-link anchor buttons on headings (h1–h6). Task descriptions and project descriptions also render via MarkdownPreview using the same `previewComponents`, so the anchor buttons appear there too — but the hash they set is always relative to the current page's URL, which may not be the detail page if the preview is shown inside a modal. The spec should clarify whether anchor links in those contexts should be suppressed or point to the canonical detail-page URL for the task/project.

## Done looks like
- Task description anchor links either (a) are hidden when rendered inside the edit/create modal, or (b) produce a URL pointing to the task detail page (e.g. `/tasks/42#section`)
- Project description anchor links similarly produce correct canonical URLs
- Note viewer behavior is unchanged

## Relevant files
- `artifacts/it-task-manager/src/components/notes/markdown-config.tsx` — `makeHeading` factory; URL construction logic
- `artifacts/it-task-manager/src/pages/task-detail.tsx` — task description rendering context
- `artifacts/it-task-manager/src/pages/project-detail.tsx` — project description rendering context
