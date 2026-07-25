# #429 — Prevent the offline queue from growing unbounded when the backend stays down for hours

**State:** PROPOSED
**Depends on:** #413

---

# Prevent the offline queue from growing unbounded when the backend stays down for hours

## What & Why
Currently there is no cap on how many mutations the queue can hold. A user who stays offline for an extended period (hours) could accumulate hundreds of entries. On reconnect, the entire batch replays synchronously, which could spike server load and cause the tab to become unresponsive. A configurable max-queue-length (e.g. 200 entries) with a visible warning when the cap is reached would protect both the client and the server.

## Done looks like
- `standaloneAddToQueue` rejects new entries (or drops the oldest) once a configurable limit is reached
- `useOfflineQueue` exposes an `isQueueFull` boolean so the UI can warn the user
- A unit test confirms the cap is respected under concurrent enqueue pressure

## Relevant files
- `artifacts/it-task-manager/src/hooks/use-offline-queue.ts`
- `artifacts/it-task-manager/src/hooks/use-offline-queue.test.ts`
