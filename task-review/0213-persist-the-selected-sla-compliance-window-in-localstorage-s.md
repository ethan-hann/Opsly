# #213 — Persist the selected SLA compliance window in localStorage so it survives a page refresh

**State:** PROPOSED
**Depends on:** #208

---

# Persist the selected SLA compliance window in localStorage

## What & Why
The dashboard SLA compliance period selector (7d / 30d / 90d / All) now lives in React state and resets to 30d on every page refresh. Teams that work exclusively with 7-day sprints or quarterly reviews would benefit from having their preference remembered across sessions.

## Done looks like
- The selected period is read from localStorage on mount (key: `sla_period_preference`, default `"30d"`)
- Switching the period writes the new value to localStorage
- The preference persists across refreshes and navigation away/back
- Falls back gracefully to `"30d"` if the stored value is invalid or missing

## Relevant files
- artifacts/it-task-manager/src/pages/dashboard.tsx — slaPeriod useState hook
