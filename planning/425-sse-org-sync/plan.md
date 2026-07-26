# #425 — Real-time org sync via SSE

> **Depends on #422** (merge #422 first). This task changes `refetchInterval` in
> `query-client.ts` and must preserve the `staleTime: 30_000` and 4xx `retry` guard
> that #422 adds to that same file.
>
> **Overlaps #462** in `routes/notes.ts` — see Risks.

## Problem / Goal

Users in the same org see stale data for up to 8 s after a teammate makes a change,
because tasks, comments, reactions, projects, workflow stages, and notes all rely on
the global 8 s poll. The SSE plumbing already exists (`GET /api/events`, one
persistent connection per user, proven by the notification bell and role-changed
events), but it can only target a single user — there's no org-wide broadcast. This
task adds `broadcastToOrg`, emits change events from every mutating route, wires
client-side cache invalidation so changes appear within ~1 round-trip, routes notes
changes through the reliable main channel (retiring the flaky 5 s notes poll), and
lowers the global poll to 60 s now that SSE is the fast path.

## Scope

- Extend the in-memory SSE registry to track `orgId` per connection and add `broadcastToOrg(orgId, event, data)`; keep `pushEvent` for user-targeted events.
- Broadcast `task-changed`, `comment-changed`, `reaction-changed`, `project-changed`, `stage-changed`, and `notes-changed` from their mutating routes.
- Register those event types in the client SSE provider; add a `use-org-sync` hook that invalidates the right React Query caches; mount it once in `App.tsx`.
- Retire the client `useNotesSSE` 5 s poll (the `notes-changed` event replaces it); raise the global `refetchInterval` 8 s → 60 s.

**Not in scope:** horizontal scaling / Redis pub-sub, presence, conflict resolution, and any change to the existing per-user `notification` / `role-changed` events or `pushEvent`.

## User Stories

- As a **teammate**, when another user creates/edits/deletes a task, posts a comment or reaction, changes a project, moves a workflow stage, or edits a note, I see it within ~1 s without reloading.
- As a **user with the notes panel open**, another user's note changes appear within ~1 s (the 5 s poll is gone).
- As a **user on a slow connection**, background polling drops to every 60 s; SSE handles fast delivery, polling is the fallback for missed events on reconnect.
- As an **existing user**, the notification bell, role-changed handling, export-ready flow, and mid-session suspension detection all keep working.

## Open Questions / Risks

1. **`use-org-sync` must NOT import orval query-key helpers — project-standard HMR trap.**
   `.agents/orval-sync-hmr-transience` forbids importing generated helpers like `getListTasksQueryKey` in app hooks: `pre-codegen.mjs` briefly resets the generated index, and any open tab importing those symbols throws a visible runtime error. The original task text lists exactly those helpers. **Resolution:** invalidate by `queryKey[0]` URL-path prefix predicate — the same pattern `useNotesSSE` already uses. Verified key shapes: `['/api/tasks', …]`, `['/api/projects']`, `['/api/workflow-stages']`, `['/api/tasks/${id}']`, `['/api/tasks/${id}/comments']`, `['/api/dashboard/...']`, and notes keys are `'/notes'`-prefixed. Prefix matching covers all of these without the risky imports.

2. **`notes.ts` overlap with #462 — order-independent, but build on whatever's there.**
   Both tasks edit `POST /notes` and `PATCH /notes/:id`. This task only swaps the broadcast call; #462 consolidates the validation queries. Whichever merges second must keep the other's change. Also: there are **three** `broadcastNoteChange(orgId)` calls — `POST`, `PATCH`, **and `DELETE`** (the original task text mentions only create/update) — all three should be swapped, and the now-unused `broadcastNoteChange` import removed.

3. **Leave the server `/notes/events` route and `addSseClient` in place.** Only the *client* stops polling; the old server SSE endpoint stays (harmless, still uses `addSseClient`). Removing it is out of scope.

4. **`query-client.ts` shared with #422.** Change only `refetchInterval` here; do not disturb #422's `staleTime: 30_000` or `retry` function.

5. **No schema changes.** Post-merge rebuild + api-server restart needed so the broadcasts and new route wiring load; no migration.
