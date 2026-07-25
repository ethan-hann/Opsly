# #344 — Confirm Discussion and History tabs each show the correct content with no cross-contamination

**State:** PROPOSED
**Depends on:** #341

---

# Confirm Discussion and History tabs each show the correct content with no cross-contamination

## What & Why
The unified "Activity & History" feed was split into Discussion and History tabs. Without a test, a future refactor could accidentally render events in the Discussion tab or comments in the History tab.

## Done looks like
- A Playwright test opens a task that has both comments and change events
- Verifies the Discussion tab shows comments and does NOT show history events
- Verifies the History tab shows change events and does NOT show comments
- Verifies the compose box appears only on the Discussion tab

## Relevant files
- `artifacts/it-task-manager/src/pages/task-detail.tsx` — tabbed Activity card (lines ~1490–1650)
