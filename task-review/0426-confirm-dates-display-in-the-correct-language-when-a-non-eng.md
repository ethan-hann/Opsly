# #426 — Confirm dates display in the correct language when a non-English locale is active

**State:** PROPOSED
**Depends on:** #411

---

Task #411 wired i18n.language through formatDate, toLocaleString, toLocaleDateString, and date-fns formatDistanceToNow across 13 files. There are no automated tests verifying the locale plumbing end-to-end, so a regression would be invisible until a user reports it.

Done looks like:
- A Playwright test switches the app language to French or Spanish and confirms that a task due date, the 'X ago' timestamp, and the calendar month dropdown display in the selected language
- Covers task-detail view (formatDate + formatDistanceToNow) and admin orgs table (toLocaleDateString)

Relevant files:
- artifacts/it-task-manager/src/lib/utils.ts
- artifacts/it-task-manager/src/hooks/use-date-locale.ts
- artifacts/it-task-manager/src/pages/task-detail.tsx
- artifacts/it-task-manager/src/pages/admin/orgs-tab.tsx
- artifacts/it-task-manager/src/components/ui/calendar.tsx
