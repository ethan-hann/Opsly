# #443 — Confirm a ?tab= deep link opens the correct tab without landing on General

**State:** PROPOSED
**Depends on:** #437

---

# Confirm a ?tab= deep link opens the correct tab without landing on General

## What & Why
The tabbed org-settings page reads the active tab from the URL query param (?tab=<value>). If that param is missing or points at a hidden/feature-gated tab, the page falls back to "general". There are no automated tests covering this routing logic, so a regression (e.g. a typo in the tab key map, or a URL that slips through to a gated tab) could go undetected.

## Done looks like
- A test that navigates to /org/settings?tab=members and asserts the Members tab is active (member list visible, Org Info card not visible).
- A test that navigates to /org/settings?tab=apiKeys with the api_keys feature disabled and asserts the page falls back to the General tab.
- A test that navigates to /org/settings?tab=bogusTab and asserts the General tab is shown.

## Relevant files
- `artifacts/it-task-manager/src/pages/org-settings.tsx` — tab visibility map and URL sync logic
- `artifacts/it-task-manager/src/hooks/use-org-context.tsx` — isFeatureEnabled, feature keys
