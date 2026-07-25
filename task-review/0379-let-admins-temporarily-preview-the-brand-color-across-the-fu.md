# #379 — Let admins temporarily preview the brand color across the full app before committing

**State:** PROPOSED
**Depends on:** #319

---

# Let admins temporarily preview the brand color across the full app before committing

## What & Why
The new mini preview card shows isolated UI samples, but admins have to save before seeing how the color looks across the real sidebar, nav, and page buttons. A "Preview in app" mode that temporarily applies the draft CSS variables to the live document (without saving) would give full confidence before applying org-wide.

## Done looks like
- A "Preview in app" button in BrandingCard temporarily applies the draft palette to the document (same mechanism as BrandingProvider but scoped to the session)
- A persistent banner indicates the user is in preview mode with "Apply" and "Discard" actions
- Navigating away or discarding reverts to the saved color instantly
- No server round-trip happens during preview; only "Apply" calls the API

## Relevant files
- `artifacts/it-task-manager/src/pages/org-settings.tsx` (BrandingCard, BrandingPreview)
- `artifacts/it-task-manager/src/context/branding-context.tsx` (BrandingProvider, buildStyleSheet)
