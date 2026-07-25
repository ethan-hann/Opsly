# #425 — Real-time org sync via SSE

**State:** PROPOSED
**Depends on:** #422

---

# Real-time org sync via SSE

## What & Why

Users in the same org currently see stale data for up to 8 seconds after a teammate makes a change. This happens because tasks, comments, reactions, projects, workflow stages, and notes all rely on the global 8-second polling interval — there is no SSE broadcast to other org members when any of these entities change.

The SSE infrastructure is already in place: `GET /api/events` maintains one persistent connection per user (proved working by the notification bell and role-changed events). However, the existing `pushEvent(userId, ...)` only targets a single user, and `broadcastToOrg` does not yet exist. Meanwhile, the `/notes/events` endpoint had proxy reliability problems and was replaced with a 5-second poll on the client — but that same proxy issue never affected `/api/events`, so routing notes changes through the main channel will work.

This task extends the existing SSE channel to carry org-wide change events, broadcasts them from every mutating route, and wires up client-side cache invalidation so changes made by any org member appear for every other member within roughly one round-trip time rather than up to 8 seconds. It also raises the global `refetchInterval` significantly now that SSE handles real-time delivery, reducing background network load.

**Prerequisite:** Task #422 must be merged first. It raises `staleTime` to 30 s and adds a `retry` guard for 4xx errors in `query-client.ts`. Step 11 of this task changes `refetchInterval` in that same file and must preserve both of those settings.

## Done looks like

- A teammate creating, editing, or deleting a task causes the task list and dashboard to update for other users within ~1 second, without a full page reload.
- A new comment or reaction posted by one user appears in the comment thread of another user viewing the same task within ~1 second.
- A project created or renamed by an admin is visible to other users immediately.
- Workflow stage changes propagate to all members instantly.
- Notes created or updated by one user appear in the notes list of another user within ~1 second, replacing the current 5-second poll.
- The browser network tab shows background polling at a much lower frequency than before (60 s instead of 8 s for most queries).
- The existing notification bell, role-changed handling, export-ready flow, and mid-session suspension detection continue to work correctly.
- Polling remains as a fallback safety net; SSE is the fast path.

## Out of scope

- Horizontal scaling / Redis pub-sub (in-memory registry is sufficient for a single-instance server).
- Presence indicators (who is currently viewing a task).
- Conflict resolution for concurrent edits.
- Changing the existing per-user `notification` or `role-changed` events.

## Steps

1. **Extend `lib/sse.ts` with org-aware tracking** — Change the connections registry from `Map<string, Response>` to store `{ res, orgId }` per userId. Update `registerSSE(userId, orgId, res)` to accept the orgId and record it. Add `broadcastToOrg(orgId, event, data)` that iterates all registered connections, writes to those whose orgId matches, and cleans up dead connections as it goes. Keep `pushEvent(userId, ...)` intact for user-targeted events.

2. **Update `/events` route to pass orgId** — In `routes/events.ts`, pass `req.orgId!` as the second argument to `registerSSE` so the connection is tagged with its org from the moment it opens. `req.orgId` is already guaranteed to be set by the `requireOrg` middleware this route uses.

3. **Broadcast task changes** — In `routes/tasks.ts`, call `broadcastToOrg(req.orgId!, 'task-changed', { taskId, action })` after each successful response in the create, update, bulk-update, delete, and bulk-delete handlers. For bulk operations, pass an array of affected IDs in the payload.

4. **Broadcast comment and reaction changes** — In `routes/comments.ts`, call `broadcastToOrg(req.orgId!, 'comment-changed', { taskId })` after create, update, and delete. Call `broadcastToOrg(req.orgId!, 'reaction-changed', { taskId })` after any reaction toggle.

5. **Broadcast project changes** — In `routes/projects.ts`, call `broadcastToOrg(req.orgId!, 'project-changed', { projectId, action })` after create, update, and delete.

   ⚠️ **Preserve changes from Task #422:** By the time this task runs, `routes/projects.ts` will already have `requirePermission('manage_projects')` added to the middleware chain of `POST /projects`, `PATCH /projects/:id`, and `DELETE /projects/:id`. Do not remove or reorder that middleware when adding the `broadcastToOrg` calls.

6. **Broadcast workflow stage changes** — In `routes/workflow-stages.ts`, call `broadcastToOrg(req.orgId!, 'stage-changed', {})` after create, update, delete, and reorder. No payload needed; the client invalidates the full stages list.

7. **Pipe notes-changed through the main SSE channel** — In `routes/notes.ts`, replace the call to `broadcastNoteChange(orgId)` (which targets the separate `/notes/events` endpoint that has proxy issues) with `broadcastToOrg(orgId, 'notes-changed', {})`.

   ⚠️ **Overlap with Task #462:** Task #462 also modifies the `POST /notes` and `PATCH /notes/:id` handlers to consolidate the three sequential validation queries into a single JOIN. If #462 has already been merged, the validation logic in those handlers will look different from the original; apply the `broadcastToOrg` change to the updated form and do not revert the query consolidation. If #462 has not yet been merged, this step only changes the broadcast call — do not touch the validation logic.

8. **Register new event types in the client SSE provider** — In `hooks/use-sse.tsx`, add `'task-changed'`, `'comment-changed'`, `'reaction-changed'`, `'project-changed'`, `'stage-changed'`, and `'notes-changed'` to the `KNOWN_EVENTS` array so the `EventSource` registers listeners for them and dispatches them to subscribers.

9. **Create `hooks/use-org-sync.ts`** — A single hook that calls `useSseEvent` for each new org-wide event type and responds with targeted React Query cache invalidations. All callbacks must be wrapped in `useCallback` with stable deps to avoid re-subscribing on every render:
   - `task-changed` → invalidate `getListTasksQueryKey()`, `getGetDashboardSummaryQueryKey()`, `getGetOverdueTasksQueryKey()`, `getGetRecentActivityQueryKey()`. If the payload has a single `taskId`, also invalidate that task's individual query key.
   - `comment-changed` → if payload has `taskId`, invalidate `getListCommentsQueryKey(taskId)` and the task events query for that task.
   - `reaction-changed` → if payload has `taskId`, invalidate `getListCommentsQueryKey(taskId)` (reactions are embedded in comment responses).
   - `project-changed` → invalidate `getListProjectsQueryKey()`. If payload has `projectId`, also invalidate that project's detail key.
   - `stage-changed` → invalidate `getListWorkflowStagesQueryKey()`.
   - `notes-changed` → invalidate all queries whose key starts with `"/notes"` (same predicate used in `useNotesSSE` today).

10. **Mount `useOrgSync` in the app layout** — Call `useOrgSync()` once in the top-level app component inside the existing `SseProvider` and `QueryClientProvider` boundaries (it only needs `useQueryClient` and `useSseEvent`, not `OrgContext`). This is simpler than mounting it inside `OrgGuard` — which now carries mid-session suspension detection and `onOrgSuspended` registration — and avoids coupling SSE cache sync to the guard's lifecycle.

11. **Retire `useNotesSSE` polling and raise `refetchInterval`** — Update `hooks/use-notes-sse.ts` to be a no-op or remove it; the `notes-changed` event in `use-org-sync.ts` now owns that invalidation. Update any component that calls `useNotesSSE()` to stop calling it.

    In `query-client.ts`, raise the global `refetchInterval` from `8_000` to `60_000` (60 seconds). SSE handles fast delivery; polling is now a long-interval fallback for missed events during reconnects.

    ⚠️ **Preserve changes from Task #422:** `query-client.ts` will already have `staleTime: 30_000` and a `retry` function that returns `false` for 4xx errors. Only change `refetchInterval` — do not remove or reset those settings.

## Relevant files

- `artifacts/api-server/src/lib/sse.ts`
- `artifacts/api-server/src/routes/events.ts`
- `artifacts/api-server/src/routes/tasks.ts`
- `artifacts/api-server/src/routes/comments.ts`
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/workflow-stages.ts`
- `artifacts/api-server/src/routes/notes.ts`
- `artifacts/it-task-manager/src/hooks/use-sse.tsx`
- `artifacts/it-task-manager/src/hooks/use-notes-sse.ts`
- `artifacts/it-task-manager/src/hooks/org-guard.tsx`
- `artifacts/it-task-manager/src/lib/query-client.ts`
- `artifacts/it-task-manager/src/App.tsx` (mounting point for `useOrgSync`)
