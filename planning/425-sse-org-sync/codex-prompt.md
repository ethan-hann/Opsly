# Codex Prompt — #425 Real-time org sync via SSE

## Task

Extend Opsly's existing per-user Server-Sent Events channel to broadcast org-wide
change events, so a change made by one org member appears for every other member
within ~1 second instead of waiting up to 8 seconds for the poll. Broadcast from the
mutating routes, invalidate the right React Query caches on the client, route notes
changes through the reliable main SSE channel (retiring a flaky 5 s poll), and lower
the global poll interval now that SSE is the fast path.

**This task depends on #422 and must merge after it.** #422 sets `staleTime: 30_000`
and a 4xx `retry` guard in `artifacts/it-task-manager/src/lib/query-client.ts`; you
change only `refetchInterval` in that file and must preserve those two settings.

Read the guardrail first — it overrides the naive reading of the client-hook step.

## Critical Guardrail — G2: no orval query-key helpers in `use-org-sync`

Project standard (`.agents/memory/orval-sync-hmr-transience.md`): never import
generated helpers such as `getListTasksQueryKey`, `getGetDashboardSummaryQueryKey`,
etc. into app-layer hooks/components. During codegen the generated index is briefly
reset and any open tab importing those symbols throws a visible runtime error.

**Invalidate by `queryKey[0]` string-prefix predicate instead** — the exact pattern
`useNotesSSE` already uses. Query keys are shaped `['/api/tasks', …params]`,
`['/api/projects']`, `['/api/workflow-stages']`, `['/api/tasks/${id}']`,
`['/api/tasks/${id}/comments']`, `['/api/dashboard/...']`; notes keys are
`'/notes'`-prefixed. Example:

```ts
queryClient.invalidateQueries({
  predicate: (q) => {
    const k = q.queryKey[0];
    return typeof k === "string" && k.startsWith("/api/tasks");
  },
});
```

Generated *hooks* (`useListTasks`, etc.) are safe to import elsewhere — only the
`getGet…QueryKey` / `getGet…QueryOptions` helpers are the hazard, and only inside app hooks.

---

## Steps

### Server
1. **`artifacts/api-server/src/lib/sse.ts`** — Change the registry from `Map<string, Response>` to store `{ res, orgId }` per userId. Update `registerSSE(userId, orgId, res)` to accept and record `orgId`. Keep `pushEvent(userId, event, data)` working. Add `broadcastToOrg(orgId, event, data)` that writes `event: <event>\ndata: <json>\n\n` to every connection whose `orgId` matches, cleaning up dead connections as it iterates (same try/catch + delete pattern as `pushEvent`).
2. **`artifacts/api-server/src/routes/events.ts`** — Pass `req.orgId!` as the second arg to `registerSSE`. `req.orgId` is guaranteed by the route's `requireOrg` middleware.
3. **`artifacts/api-server/src/routes/tasks.ts`** — After each successful mutation response, call `broadcastToOrg(req.orgId!, "task-changed", { taskId, action })` in the create, update, and single-delete handlers. For `PATCH /tasks/bulk` and `DELETE /tasks/bulk`, pass `{ taskIds: [...], action }`.
4. **`artifacts/api-server/src/routes/comments.ts`** — After create/update/delete, `broadcastToOrg(req.orgId!, "comment-changed", { taskId })`. After any reaction add/remove, `broadcastToOrg(req.orgId!, "reaction-changed", { taskId })`.
5. **`artifacts/api-server/src/routes/projects.ts`** — After create/update/delete, `broadcastToOrg(req.orgId!, "project-changed", { projectId, action })`. **#422 adds a `hasPermission(req, "manage_projects")` guard at the top of these handlers — do not remove or reorder it; add the broadcast after the mutation succeeds.**
6. **`artifacts/api-server/src/routes/workflow-stages.ts`** — After create/update/delete/reorder, `broadcastToOrg(req.orgId!, "stage-changed", {})`.
7. **`artifacts/api-server/src/routes/notes.ts`** — Replace **all three** `broadcastNoteChange(orgId)` calls (`POST /notes`, `PATCH /notes/:id`, **and `DELETE /notes/:id`**) with `broadcastToOrg(orgId, "notes-changed", {})`. Then remove the now-unused `broadcastNoteChange` import from `../lib/notes-sse` (keep `addSseClient` — it's still used by the `/notes/events` route; leave that route in place).
   - **Overlap with #462:** if #462 already merged, `POST`/`PATCH` will have consolidated (JOIN) validation — apply the broadcast swap on top; don't revert it. If #462 hasn't merged, change only the broadcast calls here; don't touch validation.

### Client
8. **`artifacts/it-task-manager/src/hooks/use-sse.tsx`** — The `KNOWN_EVENTS` array (inside `connect()`) is `["notification", "role-changed"]`. Add `"task-changed"`, `"comment-changed"`, `"reaction-changed"`, `"project-changed"`, `"stage-changed"`, `"notes-changed"`.
9. **New file `artifacts/it-task-manager/src/hooks/use-org-sync.ts`** — Calls `useSseEvent(...)` for each new event type and invalidates caches **by prefix predicate (Guardrail G2)**. Wrap every handler in `useCallback` with stable deps (only `queryClient`) so it doesn't re-subscribe each render. Mapping:
   - `task-changed` → invalidate keys starting with `"/api/tasks"` (covers list, individual task, and comments) and `"/api/dashboard"` (summary, overdue, recent activity).
   - `comment-changed` → if payload has `taskId`, invalidate keys starting with `` `/api/tasks/${taskId}/comments` `` plus the task events key for that task; otherwise invalidate `"/api/tasks"`.
   - `reaction-changed` → same as `comment-changed` for that `taskId` (reactions are embedded in comment responses).
   - `project-changed` → invalidate keys starting with `"/api/projects"`.
   - `stage-changed` → invalidate keys starting with `"/api/workflow-stages"`.
   - `notes-changed` → invalidate keys starting with `"/notes"` (copy the predicate from the current `use-notes-sse.ts` exactly).
10. **`artifacts/it-task-manager/src/App.tsx`** — Call `useOrgSync()` once in the top-level app component, inside the existing `SseProvider` and `QueryClientProvider` boundaries. It needs only `useQueryClient` and `useSseEvent`; do not mount it inside `OrgGuard`.
11. **Retire the notes poll and raise the interval:**
    - Make `artifacts/it-task-manager/src/hooks/use-notes-sse.ts` a no-op (or delete it) and remove/adjust every caller of `useNotesSSE()`; the `notes-changed` handler now owns that invalidation.
    - In `artifacts/it-task-manager/src/lib/query-client.ts`, change `refetchInterval` from `8_000` to `60_000`. **Preserve #422's `staleTime: 30_000` and the `retry` function — change only `refetchInterval`.**

## Acceptance Criteria

- A teammate's task / comment / reaction / project / stage / note change appears for other org members within ~1 s, no reload.
- Notes changes appear within ~1 s; the 5 s notes poll is gone.
- The Network tab shows background polling at 60 s (not 8 s).
- Notification bell, role-changed, export-ready, and mid-session suspension detection still work.
- Broadcasts only reach members of the originating org (no cross-org leakage).

## Relevant Files / Paths

- `artifacts/api-server/src/lib/sse.ts`
- `artifacts/api-server/src/routes/{events,tasks,comments,projects,workflow-stages,notes}.ts`
- `artifacts/it-task-manager/src/hooks/{use-sse.tsx,use-notes-sse.ts}` and new `use-org-sync.ts`
- `artifacts/it-task-manager/src/App.tsx`
- `artifacts/it-task-manager/src/lib/query-client.ts`

## Standards to Follow (from `.agents/`)

- **orval-sync HMR transience** — Guardrail G2 above; no generated `getGet…QueryKey` helpers in app hooks.
- **American spellings** — American English in all strings, comments, names, tests.
- **Post-merge** — pipeline runs `pnpm install --frozen-lockfile`, `db run push-force`, `api-server run build`; restart the api-server workflow so broadcasts/route wiring load. No schema change, no migration.

## Out of Scope — do NOT change

- Do **not** import orval query-key helpers in `use-org-sync.ts` (Guardrail G2).
- Do **not** remove #422's `staleTime`/`retry` from `query-client.ts` — change only `refetchInterval`.
- Do **not** remove or reorder the `hasPermission("manage_projects")` guard #422 adds to `projects.ts`.
- Do **not** remove the server `/notes/events` route or `addSseClient` from `notes-sse.ts` (only the client stops polling).
- Do **not** change the existing per-user `notification` / `role-changed` events or the `pushEvent` API.
- Do **not** add Redis / external pub-sub, presence indicators, or conflict resolution.
- Do **not** modify the notes **validation** logic (that's #462) — this task only swaps the broadcast call in `notes.ts`.
