# #462 — API server query performance improvements

**State:** PROPOSED
**Depends on:** #422

---

# API server query performance improvements

## What & Why

Several API endpoints make sequential database round-trips where the queries are independent and could run in parallel, and one endpoint builds an in-memory merge of four separate result sets when a more targeted query would be cheaper. These are not showstoppers today, but they will become noticeable under load as the dataset grows.

**Dashboard `/activity` — 4 sequential queries**

The activity endpoint (`GET /dashboard/activity`) fires four `await db.select(...)` calls one after another (recent tasks, recent comments, recent projects, recent custom-field events), then merges and sorts the results in memory. None of these queries depend on each other's output, so they can run concurrently. Under moderate load, parallelising them with `Promise.all` roughly quarters the response time for this endpoint.

**Notes routes — sequential validation checks**

`POST /notes` and `PATCH /notes/:id` run `validateProjectId`, `validateTaskId`, and `validateTaskBelongsToProject` as separate sequential awaited calls. These could be merged into a single JOIN query that validates all three constraints in one round-trip.

**Dashboard summary — legacy status coercion repeated per row**

The summary endpoint uses `safeStatusInt()` to coerce legacy string statuses on every row returned, which adds a small CPU cost per task. Now that all tasks are stored with integer statuses, a migration to backfill any remaining string rows (if they exist) and remove the coercion function would simplify the query and make it faster at scale.

**Missing `staleTime`-aware cache headers on read endpoints**

Several read-only endpoints that return stable, permission-gated data (roles, workflow stages, task templates) do not set `Cache-Control` headers. Adding `Cache-Control: private, max-age=<N>` aligned with the client's `staleTime` setting (30 s after Task #422) allows browsers to serve cached responses without hitting the server at all during the stale window, eliminating the server round-trip entirely for those background refetches.

**Prerequisite:** Task #422 must be merged first so the `staleTime: 30_000` that the `Cache-Control: max-age=30` headers below are calibrated against is already in place.

## Done looks like

- The dashboard activity endpoint (`GET /dashboard/activity`) completes in roughly one quarter of its previous time under concurrent load, verified by comparing response times with and without `Promise.all`.
- Notes create and update endpoints make one fewer round-trip to the database per request.
- `GET /roles`, `GET /workflow-stages`, `GET /task-templates` include `Cache-Control: private, max-age=30` response headers; the browser's network tab shows 304 or cached responses on repeated polls within the stale window.
- No behaviour changes visible to end users.

## Out of scope

- Introducing Redis or any external cache layer.
- Query index analysis (tracked separately in Task #205).
- Rewriting the SLA overshoot calculation (tracked separately in Task #219).
- The `safeStatusInt()` backfill migration — include only if the migration is trivially safe (all rows already have integer statuses); otherwise leave for a dedicated migration task.

## Steps

1. **Parallelise the dashboard activity queries** — In `routes/dashboard.ts`, wrap the four sequential `await db.select(...)` calls inside the `/dashboard/activity` handler in a single `Promise.all([...])`. Each query remains independent; collect all four results, then proceed with the existing in-memory merge and sort.

   ⚠️ **Preserve changes from Task #422:** By the time this task runs, `routes/dashboard.ts` will have a `requireSlaTrackingFeature` middleware added to `GET /dashboard/sla-summary`. If you touch the file, do not remove that middleware. This task only concerns the `/dashboard/activity` handler; leave the `/dashboard/sla-summary` handler as-is.

   If step 4 (removing `safeStatusInt`) is also done, note that `safeStatusInt` is used inside the `/dashboard/summary` handler, not the `/dashboard/activity` handler — they are separate routes in the same file. Only remove `safeStatusInt` from the summary handler if no tasks have string statuses; do not touch the feature-gate middleware on sla-summary.

2. **Merge notes validation into a single query** — In `routes/notes.ts`, replace the three sequential validation helpers (`validateProjectId`, `validateTaskId`, `validateTaskBelongsToProject`) in the `POST` and `PATCH` handlers with a single JOIN query that selects the task and project in one round-trip and validates all three constraints from the result. If the note does not reference a task or project, skip the consolidated query.

   ⚠️ **Overlap with Task #425:** Task #425 also modifies the `POST /notes` and `PATCH /notes/:id` handlers to replace `broadcastNoteChange(orgId)` with `broadcastToOrg(orgId, 'notes-changed', {})`. If #425 has already been merged, the broadcast call in those handlers will already be `broadcastToOrg`; apply this step's query consolidation on top of that without reverting the broadcast change. If #425 has not yet merged, this step only touches the validation logic — do not change the broadcast call.

3. **Add `Cache-Control` headers to stable list endpoints** — In `routes/roles.ts`, `routes/workflow-stages.ts`, and `routes/task-templates.ts`, add `res.setHeader('Cache-Control', 'private, max-age=30')` to the GET list handlers before sending the response. Use `private` so the header is respected only by the requesting browser, not shared proxies. The `max-age` matches the `staleTime` introduced in Task #422.

4. **Remove `safeStatusInt()` if safe** — Check whether any rows in `tasksTable` still have string-typed statuses. If none exist, remove the `safeStatusInt()` helper and its call sites in `routes/dashboard.ts`, replacing with a direct integer column reference. If string rows remain, skip this step and file a backfill migration separately.

## Relevant files

- `artifacts/api-server/src/routes/dashboard.ts`
- `artifacts/api-server/src/routes/notes.ts`
- `artifacts/api-server/src/routes/roles.ts`
- `artifacts/api-server/src/routes/workflow-stages.ts`
- `artifacts/api-server/src/routes/task-templates.ts`
