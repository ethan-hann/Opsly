# #247 — Confirm GET /tasks?watching=true returns no results when the user has no watcher rows (empty state)

**State:** PROPOSED
**Depends on:** #183

---

# Watching filter — zero watcher rows edge case

## What & Why
Task #183 added isolation tests confirming the watching filter can't surface
cross-org tasks. The happy-path test covers a single own-org task. Missing is
the scenario where the calling user has zero watcher rows at all — the join
should simply return an empty list without error, and no downstream select
(getOrgStages, slaPolicies, buildTaskWithProject) should fire.

## Done looks like
- In task-watchers.test.ts "GET /api/tasks?watching=true — org isolation":
  - "returns 200 [] when the user has no watcher rows"
  - Push [] to selectQueue; assert res.body = [] and selectQueue fully consumed

## Relevant files
- artifacts/api-server/src/routes/task-watchers.test.ts
- artifacts/api-server/src/routes/tasks.ts (~line 460-478)
