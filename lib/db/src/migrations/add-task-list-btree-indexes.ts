/**
 * Migration: add B-tree indexes for fast task list filtering and sorting.
 *
 * Purpose
 * -------
 * The task list endpoint (GET /tasks) filters on org_id, status, priority,
 * category, assignee, and project_id, and sorts by created_at DESC. Without
 * indexes, every request performs a full sequential scan on the tasks table.
 * As orgs accumulate thousands of tasks this becomes noticeably slow.
 *
 * B-tree indexes are the right choice here because the filter predicates all
 * use equality (=) or range (<= / >=) operators, not ILIKE — the same columns
 * that benefit from trigram indexes for search use B-tree indexes for exact
 * filtering.
 *
 * Indexes created
 * ---------------
 *   tasks_org_id_idx        — B-tree on tasks.org_id
 *                             (every query is scoped to a single org)
 *   tasks_org_created_idx   — B-tree on (tasks.org_id, tasks.created_at DESC)
 *                             (supports the default created_at DESC sort within an org)
 *   tasks_status_idx        — B-tree on tasks.status
 *   tasks_priority_idx      — B-tree on tasks.priority
 *   tasks_category_idx      — B-tree on tasks.category
 *   tasks_assignee_idx      — B-tree on tasks.assignee
 *   tasks_project_id_idx    — B-tree on tasks.project_id
 *   tasks_due_date_idx      — B-tree on tasks.due_date
 *                             (used by the overdue route and date-range filters)
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-task-list-btree-indexes
 *
 * Idempotent: safe to re-run (uses CREATE INDEX IF NOT EXISTS).
 *
 * Notes for future developers
 * ---------------------------
 * The task list route (artifacts/api-server/src/routes/tasks.ts) relies on
 * these indexes for performance at scale. The composite (org_id, created_at)
 * index is the primary one for the default list view; the single-column
 * org_id index remains useful when the planner chooses a different access
 * path for filtered queries.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 1. org_id — every list query is scoped to a single org
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_org_id_idx
        ON tasks (org_id);
    `);
    console.log("Created index: tasks_org_id_idx");

    // 2. (org_id, created_at DESC) — covers the default sort for the list view
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_org_created_idx
        ON tasks (org_id, created_at DESC);
    `);
    console.log("Created index: tasks_org_created_idx");

    // 3. status — used by the ?status= filter
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_status_idx
        ON tasks (status);
    `);
    console.log("Created index: tasks_status_idx");

    // 4. priority — used by the ?priority= filter and SLA policy matching
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_priority_idx
        ON tasks (priority);
    `);
    console.log("Created index: tasks_priority_idx");

    // 5. category — used by the ?category= filter
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_category_idx
        ON tasks (category);
    `);
    console.log("Created index: tasks_category_idx");

    // 6. assignee — used by the ?assignee= filter
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_assignee_idx
        ON tasks (assignee);
    `);
    console.log("Created index: tasks_assignee_idx");

    // 7. project_id — used by the ?projectId= filter
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_project_id_idx
        ON tasks (project_id);
    `);
    console.log("Created index: tasks_project_id_idx");

    // 8. due_date — used by the overdue route and ?dateFrom= / ?dateTo= range filters
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_due_date_idx
        ON tasks (due_date);
    `);
    console.log("Created index: tasks_due_date_idx");

    console.log(
      "\nMigration complete: B-tree indexes created on tasks.org_id, " +
        "(org_id, created_at), tasks.status, tasks.priority, tasks.category, " +
        "tasks.assignee, tasks.project_id, tasks.due_date."
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
