/**
 * Migration: add task_watchers table.
 *
 * Purpose
 * -------
 * Implements the Task Watchers feature. Any org member can watch a task to
 * receive in-app notifications when the task's status, priority, or assignee
 * changes, or when a new comment is posted.
 *
 * Schema
 * ------
 *   task_watchers (
 *     task_id    INTEGER  NOT NULL → tasks.id ON DELETE CASCADE
 *     user_id    VARCHAR  NOT NULL → users.id ON DELETE CASCADE
 *     org_id     VARCHAR  NOT NULL → organizations.id ON DELETE CASCADE
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *     PRIMARY KEY (task_id, user_id)
 *   )
 *
 *   Indexes:
 *     task_watchers_task_id_idx  — fast watcher count + list for a task
 *     task_watchers_user_org_idx — fast "tasks I watch in org X" query
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-task-watchers
 *
 * Idempotent: safe to re-run.
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
      CREATE TABLE IF NOT EXISTS task_watchers (
        task_id    INTEGER     NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id    VARCHAR     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_id     VARCHAR     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (task_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS task_watchers_task_id_idx
        ON task_watchers (task_id);

      CREATE INDEX IF NOT EXISTS task_watchers_user_org_idx
        ON task_watchers (user_id, org_id);
    `);

    console.log(
      "Migration complete: task_watchers table created with composite PK and indexes.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
