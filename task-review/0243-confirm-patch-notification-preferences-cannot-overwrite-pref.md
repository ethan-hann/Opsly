# #243 — Confirm PATCH /notification-preferences cannot overwrite preferences for another org via a live-DB test

**State:** PROPOSED
**Depends on:** #127

---

# Live-DB isolation test for PATCH /notification-preferences

## What & Why
Task #127 added three mock-based isolation tests for notification routes. The
PATCH /notification-preferences test was intentionally kept mock-based because
the mock middleware injects req.user.id = "test-user-a" which has no row in
the real users table (FK constraint on notification_preferences.user_id).

A complementary live-DB test would be stronger: seed a real notificationPreference
row for Org B, PATCH as Org A, and assert Org B's preference row is unchanged.
This requires either (a) using orgAUserId (a real user) as the middleware-injected
userId for the DB test, or (b) adding a helper user row for "test-user-a".

## Done looks like
- isolation-db.test.ts: "DB isolation — PATCH /api/notification-preferences"
  → Org B's notificationPreferencesTable row is unchanged after Org A PATCH
  → Response is 200 and only reflects Org A scoping

## Relevant files
- artifacts/api-server/src/routes/isolation-db.test.ts
- artifacts/api-server/src/routes/notifications.ts (PATCH handler, lines 240-290)
- lib/db/src/schema/notifications.ts (notificationPreferencesTable schema)
