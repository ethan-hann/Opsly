---
name: Post-merge procedure
description: What must run after every task merge — schema push + API rebuild — and how it's automated.
---

# Post-merge procedure

## Rule
After **every** task merge into main, run:
1. `pnpm install --frozen-lockfile` — pick up any new dependencies
2. `pnpm --filter @workspace/db run push-force` — apply schema DDL changes
3. `pnpm --filter @workspace/api-server run build` — rebuild the API bundle

**Why:** Merged tasks routinely add new DB tables/columns and new API routes. Without the schema push the API crashes with "column does not exist". Without the rebuild, new routes are unreachable.

## Automation
This is codified in `scripts/post-merge.sh` and wired as the Replit post-merge script (timeout: 180 000 ms). It runs automatically after each task merge, followed by workflow reconciliation which restarts the running workflows.

## Backfill migrations
`drizzle push-force` handles DDL (tables, columns, indexes). Backfill scripts (`pnpm --filter @workspace/db migrate:*`) for seeding permission rows or other data must still be run **manually** after the post-merge script — check `git diff HEAD~N HEAD --name-only | grep migrations/` after a merge to spot them, then run each with `pnpm --filter @workspace/db migrate:<name>`.

## Port conflicts
If workflows fail with EADDRINUSE after a merge, run `fuser -k 8080/tcp 20999/tcp` before restarting them.
