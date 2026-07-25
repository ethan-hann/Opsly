# #412 — Prevent queued offline changes from being lost when the user clears browser storage

**State:** PROPOSED
**Depends on:** #400

---

# Prevent queued offline changes from being lost when browser storage is cleared

## What & Why
The offline mutation queue is persisted in IndexedDB (idb-keyval key `offline-mutation-queue`). IndexedDB can be cleared by the browser under storage pressure or by the user manually clearing site data. When that happens, any queued mutations silently vanish. Adding a warning or export option gives users a safety net.

## Done looks like
- When the app detects the queue drops to 0 unexpectedly (user was offline with queued items and the queue disappeared without a flush), a persistent warning toast fires
- When the user has queued items and tries to close/refresh, a browser beforeunload confirmation is shown
- Optionally a 'Download pending changes' button in the offline banner lets the user export queued payloads as JSON

## Relevant files
- `artifacts/it-task-manager/src/hooks/use-offline-queue.ts`
- `artifacts/it-task-manager/src/components/offline-banner.tsx`
