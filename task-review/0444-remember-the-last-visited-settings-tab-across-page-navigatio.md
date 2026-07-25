# #444 — Remember the last-visited settings tab across page navigations

**State:** PROPOSED
**Depends on:** #437

---

# Remember the last-visited settings tab across page navigations

## What & Why
The org-settings page syncs the active tab to the URL (?tab=<value>), but if a user navigates away and returns via the sidebar link (which goes to /org/settings with no query param), they land back on General even if they were mid-task on another tab. Persisting the last-visited tab in localStorage or sessionStorage would let them continue where they left off.

## Done looks like
- On tab change, the chosen tab key is written to localStorage (key: "orgSettings.lastTab").
- On mount, if no ?tab= param is present, the stored key is used as the initial tab (falling back to "general" if the stored tab is no longer visible due to a feature-flag change).
- The URL still updates when the tab changes so direct links remain shareable.

## Relevant files
- `artifacts/it-task-manager/src/pages/org-settings.tsx` — handleTabChange and activeTab derivation logic
