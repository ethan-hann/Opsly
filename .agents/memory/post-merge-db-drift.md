---
name: Post-merge DB schema drift
description: After a task-agent merge, dev DB may lack new tables/columns until drizzle push runs
---
Merged features can fail at runtime (500s, endless loading spinners) because the dev database was never migrated after the merge.

**Why:** Task agents work in isolated envs; their schema changes land as code only. Seen with a missing table causing repeated 500s, and a NOT NULL column addition blocking `pnpm --filter @workspace/db run push` until existing NULL rows were backfilled.

**How to apply:** When a merged feature errors at the DB layer, check the table/column exists, backfill any NULLs blocking NOT NULL constraints, then run the db push script. Also restart the API server workflow — it may still run pre-merge code (404s on new routes).
