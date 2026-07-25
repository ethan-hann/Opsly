# #416 — Confirm layout mode and tab selection survive a page refresh

**State:** PROPOSED
**Depends on:** #405

---

# Confirm layout mode and tab selection survive a page refresh

## What & Why
The tabbed layout toggle writes to `localStorage` under `project-detail-layout-mode`. If the read-on-mount path is broken — or the key is accidentally cleared — users will silently fall back to stacked mode every visit. Worth a targeted confirmation before the feature is relied on.

## Done looks like
- Navigating to a project detail page in tabbed mode, refreshing, and confirming the page reopens in tabbed mode
- Switching to the Notes or SLA tab, refreshing, and confirming the correct tab is restored (if tab persistence is added) or that the page at least doesn't throw/flash unexpectedly
- Confirming the list/board `viewMode` preference is unaffected by layout mode changes

## Relevant files
- `artifacts/it-task-manager/src/pages/project-detail.tsx` — `layoutMode` state + localStorage read/write
