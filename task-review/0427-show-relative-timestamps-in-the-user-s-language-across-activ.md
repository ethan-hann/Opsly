# #427 — Show relative timestamps in the user's language across activity feeds

**State:** PROPOSED
**Depends on:** #411

---

Task #411 fixed formatDistanceToNow in comments, note cards, and notification bell via useDateLocale(). However, the Recent Activity feed on the dashboard uses formatTimeAgo (a custom formatter that returns hardcoded English strings like '5m ago', '2h ago'). These strings are never translated.

Done looks like:
- formatTimeAgo in src/lib/utils.ts is replaced or supplemented with a locale-aware variant using date-fns formatDistanceToNow or i18n keys for the short units
- Dashboard Recent Activity shows the correct language for all 8 supported locales

Relevant files:
- artifacts/it-task-manager/src/lib/utils.ts
- artifacts/it-task-manager/src/pages/dashboard.tsx
- artifacts/it-task-manager/src/hooks/use-date-locale.ts
