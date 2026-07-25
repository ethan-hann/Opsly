# #205 — Confirm the task-list query index prevents full-table scans as task volume grows

**State:** PROPOSED
**Depends on:** #204

---

# Confirm the task-list query index prevents full-table scans as task volume grows

## What & Why
tasks.ts (line 375) notes a dependency on B-tree indexes on tasks(org_id, created_at) and several other columns, added by the `migrate:add-task-list-btree-indexes` migration. There is no automated EXPLAIN check confirming those indexes exist and are selected by the planner — the same gap that existed for task_events before this task. A dropped or renamed index would silently cause sequential scans at scale with no CI signal.

## Done looks like
- A new live-DB test file (e.g. `task-list-index.test.ts`) follows the same pattern as `task-events-index.test.ts`
- Structural check: pg_indexes confirms the composite (org_id, created_at) index exists on tasks
- Plan check: EXPLAIN (FORMAT JSON) with enable_seqscan=off on the main list query asserts an Index Scan, not a Seq Scan
- Suite is gated behind DATABASE_URL and skips in unit mode

## Relevant files
- `artifacts/api-server/src/routes/task-events-index.test.ts` (pattern to follow)
- `artifacts/api-server/src/routes/tasks.ts` (line 375 — note about required indexes)
- `lib/db/src/migrations/` (add-task-list-btree-indexes migration)
