# #250 — Confirm notifyTaskUpdated fans out to watchers and skips the actor

**State:** PROPOSED
**Depends on:** #126

---

# Unit test for notifyTaskUpdated fan-out logic

## What & Why
Task #126 added unit tests for createNotification, notifyTaskAssigned, and
notifyCommentAdded. notifyTaskUpdated (also in lib/notifications.ts) fans out
to a list of recipientUserIds (assignee + watchers) and filters out the actor
— but has no dedicated test. A bug in the filter or the fan-out loop would
silently drop or duplicate notifications.

## Done looks like
- In artifacts/api-server/src/lib/notifications.test.ts, new describe block:
  "notifyTaskUpdated"
  · "notifies all recipients except the actor" — 3 recipients, 1 is the actor;
    assert insertSpy called twice (selectQueue ordered: 2 prefs then 2 counts)
  · "is a no-op when all recipients are the actor" — recipientUserIds = [actorId]
    → insertSpy not called

## Relevant files
- artifacts/api-server/src/lib/notifications.ts (~line 130–161)
- artifacts/api-server/src/lib/notifications.test.ts (task #126)
