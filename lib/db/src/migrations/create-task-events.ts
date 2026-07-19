/**
 * Migration: create task_events table.
 *
 * Purpose
 * -------
 * The task_events table is an immutable audit log of field-level changes to
 * tasks. One row is inserted per changed field on every PATCH, plus a
 * synthetic "created" row when a task is first inserted.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-task-events
 *
 * Idempotent: safe to re-run; skips if the table already exists.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'task_events'
      ) AS exists
    `);

    if (rows[0]?.exists) {
      console.log("Table task_events already exists — skipping. ✓");
    } else {
      await pool.query(`
        CREATE TABLE task_events (
          id         SERIAL PRIMARY KEY,
          task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          org_id     VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          actor_id   TEXT,
          actor_name TEXT,
          field      TEXT NOT NULL,
          old_value  TEXT,
          new_value  TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      console.log("Created table task_events. ✓");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
