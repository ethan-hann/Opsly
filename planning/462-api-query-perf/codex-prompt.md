# Codex Prompt — #462 API server query performance improvements

## Task

Make three backend performance improvements in the Opsly `api-server`, with **no
user-visible behavior change**: parallelize independent sequential DB queries in the
dashboard activity endpoint, merge the notes validation checks into a single JOIN,
and add browser cache headers to stable read-only list endpoints.

**This task depends on #422 and must merge after it** — the `Cache-Control: max-age=30`
headers are calibrated to the `staleTime: 30_000` that #422 introduces on the client.

Read the guardrail first.

## Critical Guardrail — do NOT remove `safeStatusInt()`

The original task included a step to remove `safeStatusInt()`, claiming it's used
"only in the summary handler." That is **incorrect** — it's used in multiple handlers
in `routes/dashboard.ts`, including `/dashboard/sla-summary` (~line 352) and
`/dashboard/summary` (~lines 41/66/100). Removing it safely requires proving no
`tasksTable` rows still have string-typed statuses **and** a coordinated multi-site
edit plus a backfill migration. **Skip it entirely in this task.** Leave
`safeStatusInt()` and all its call sites unchanged.

---

## Steps

1. **Parallelize dashboard activity queries** — In `artifacts/api-server/src/routes/dashboard.ts`, the `GET /dashboard/activity` handler (~line 153) fires four independent sequential `await db.select(...)` calls (recent tasks, comments, projects, custom-field events). Wrap them in a single `Promise.all([...])`, then keep the existing in-memory merge and sort. Do not change query logic — only run them concurrently.
   - **Do not touch** the `/dashboard/summary` or `/dashboard/sla-summary` handlers. #422 adds a `requireSlaTrackingFeature` middleware to `/dashboard/sla-summary`; leave it intact.

2. **Merge notes validation into one JOIN** — In `artifacts/api-server/src/routes/notes.ts`, the `POST /notes` and `PATCH /notes/:id` handlers run `validateProjectId`, `validateTaskId`, and `validateTaskBelongsToProject` as three sequential awaited calls. Replace them with a single JOIN query that fetches the task (and its project) in one round-trip and validates all three constraints from the result:
   - project exists in the org (when `projectId` is set),
   - task exists in the org (when `taskId` is set),
   - task belongs to the project (when both are set).
   Preserve the **exact** existing 400 responses/messages (`"Invalid projectId"`, `"Invalid taskId"`, `"Task does not belong to the specified project"`). Skip the consolidated query entirely when the note references neither a task nor a project. If the three helper functions become unused afterward, remove them.
   - **Overlap with #425:** if #425 already merged, these handlers call `broadcastToOrg(orgId, "notes-changed", {})` — keep that; only refactor validation. If #425 hasn't merged, they call `broadcastNoteChange(orgId)` — leave that call alone; only refactor validation.

3. **Add `Cache-Control` to stable list endpoints** — In the `GET` list handlers of `artifacts/api-server/src/routes/roles.ts`, `artifacts/api-server/src/routes/workflow-stages.ts`, and `artifacts/api-server/src/routes/task-templates.ts`, call `res.setHeader("Cache-Control", "private, max-age=30")` before sending the response. Use `private` (browser-only, not shared proxies); `max-age=30` matches #422's client `staleTime`.

## Acceptance Criteria

- `GET /dashboard/activity` runs its four queries concurrently via `Promise.all` and returns the same merged/sorted payload as before (roughly a quarter of the prior latency under concurrent load).
- `POST /notes` and `PATCH /notes/:id` make one fewer DB round-trip for validation, with identical success behavior and identical 400 error messages.
- `GET /roles`, `GET /workflow-stages`, `GET /task-templates` return `Cache-Control: private, max-age=30`; repeated polls within 30 s are served from cache or return 304.
- `safeStatusInt()` is unchanged.
- No user-visible behavior change anywhere.

## Relevant Files / Paths

- `artifacts/api-server/src/routes/dashboard.ts` (`/dashboard/activity` handler only)
- `artifacts/api-server/src/routes/notes.ts` (`POST` + `PATCH` validation)
- `artifacts/api-server/src/routes/{roles,workflow-stages,task-templates}.ts` (GET list handlers)

## Standards to Follow (from `.agents/`)

- **American spellings** — American English in comments, names, tests.
- **api-server imports zod schemas from `@workspace/api-zod`, never raw `zod`.** No new packages should be needed; the JOIN uses the existing `drizzle-orm` imports already in `notes.ts`.
- **Post-merge** — pipeline runs `pnpm install --frozen-lockfile`, `db run push-force`, `api-server run build`; restart the api-server workflow. No schema change, no migration (given `safeStatusInt` is left alone).

## Out of Scope — do NOT change

- Do **not** remove `safeStatusInt()` or run any backfill migration (Guardrail above).
- Do **not** touch `/dashboard/summary` or `/dashboard/sla-summary`, and do **not** remove the `requireSlaTrackingFeature` middleware #422 adds to `/dashboard/sla-summary`.
- Do **not** change the notes **broadcast** call (that's #425) — this task only refactors notes validation.
- Do **not** add Redis or any external cache layer.
- Do **not** change query indexes (#205) or the SLA overshoot calc (#219).
