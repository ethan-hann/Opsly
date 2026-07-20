/**
 * Migration: add a covering index on task_events(task_id, org_id) for fast
 * per-task history queries.
 *
 * Purpose
 * -------
 * The task_events table has no indexes beyond its primary key. The
 * GET /tasks/:id/events endpoint filters by both task_id and org_id on every
 * request. Without an index every call does a full sequential scan; as event
 * volume grows (each PATCH can write 1–7 rows) this becomes a bottleneck.
 *
 * A composite B-tree index on (task_id, org_id) covers the WHERE clause
 * completely and makes the lookup O(log n) regardless of total row count.
 * org_id is included as the second column so the index also enforces the
 * cross-org safety check in a single index scan.
 *
 * Index created
 * -------------
 *   task_events_task_id_org_id_idx — B-tree on (task_events.task_id, task_events.org_id)
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-task-events-index
 *
 * Idempotent: safe to re-run (uses CREATE INDEX IF NOT EXISTS).
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS task_events_task_id_org_id_idx
        ON task_events (task_id, org_id);
    `);
    console.log("Created index: task_events_task_id_org_id_idx");

    console.log(
      "\nMigration complete: composite B-tree index on task_events(task_id, org_id) created."
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
