# #462 — API server query performance improvements

> **Depends on #422** (merge #422 first) — the `Cache-Control: max-age=30` headers
> below are calibrated to the `staleTime: 30_000` that #422 introduces.
>
> **Overlaps #425** in `routes/notes.ts` — see Risks.

## Problem / Goal

A few API endpoints do sequential DB round-trips where the queries are independent,
and stable read endpoints don't set cache headers, so the browser re-hits the server
on every background poll. None of this breaks today, but it will hurt as the dataset
grows. This task parallelizes the dashboard activity queries, merges the notes
validation checks into one round-trip, and adds cache headers to stable list
endpoints — all with no user-visible behavior change.

## Scope

- Parallelize the four independent sequential queries in `GET /dashboard/activity` with `Promise.all`.
- Merge the three sequential notes validation queries (`validateProjectId`, `validateTaskId`, `validateTaskBelongsToProject`) in `POST /notes` and `PATCH /notes/:id` into one JOIN.
- Add `Cache-Control: private, max-age=30` to `GET /roles`, `GET /workflow-stages`, `GET /task-templates`.

**Not in scope:** Redis / external cache, query index analysis (#205), SLA overshoot calc (#219), and — see Risks — removing `safeStatusInt()`.

## User Stories

- As an **operator under load**, `GET /dashboard/activity` returns in roughly a quarter of its previous time (four queries run concurrently).
- As a **user**, notes create/update make one fewer DB round-trip, with identical validation behavior and error messages.
- As a **user on a slow connection**, `GET /roles`, `GET /workflow-stages`, `GET /task-templates` serve from browser cache (or return 304) within the 30 s stale window, eliminating redundant round-trips.
- As **any user**, nothing about the observable behavior changes.

## Open Questions / Risks

1. **Do NOT remove `safeStatusInt()` (the original task's step 4).** The task text claims it's used "only in the summary handler," but it's actually used in **multiple** handlers in `routes/dashboard.ts`, including `/dashboard/sla-summary` ([dashboard.ts:352](artifacts/api-server/src/routes/dashboard.ts:352)) and `/dashboard/summary` (lines 41/66/100). Removing it safely requires proving no `tasksTable` rows have string statuses **and** a coordinated multi-site change plus a backfill migration. Per the task's own "out of scope" clause, leave it for a dedicated migration task. **Flag for Ethan** if he wants it done now — it's a separate change.

2. **`notes.ts` overlap with #425 — order-independent, build on whatever's there.** Both edit `POST /notes` and `PATCH /notes/:id`. This task consolidates the validation queries; #425 swaps `broadcastNoteChange(...)` → `broadcastToOrg(orgId, "notes-changed", {})`. Whichever merges second keeps the other's change. Preserve the exact 400 error messages when consolidating validation.

3. **`/dashboard/sla-summary` gains a feature-gate middleware in #422.** When touching `dashboard.ts`, do not remove it. This task only touches `/dashboard/activity`; leave `/dashboard/summary` and `/dashboard/sla-summary` handlers alone.

4. **No schema changes** (assuming Risk #1's `safeStatusInt` removal is skipped). Post-merge rebuild + api-server restart; no migration.
