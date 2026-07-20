/**
 * Migration: create workflow_stages table and migrate tasks.status from
 * the hardcoded enum (todo/in_progress/blocked/done) to org-scoped stage IDs.
 *
 * Purpose
 * -------
 * workflow_stages replaces the hardcoded task status enum. Each org gets four
 * default stages pre-seeded. Existing task rows have their status column
 * rewritten from the enum string to the matching stage's integer id (stored
 * as text for schema compatibility with the existing tasks.status column).
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-workflow-stages
 *
 * Idempotent: safe to re-run.
 */

import pg from "pg";

const { Pool } = pg;

const DEFAULT_STAGES = [
  { name: "To Do",       color: "#6b7280", type: "open",   position: 0, legacyStatus: "todo" },
  { name: "In Progress", color: "#f59e0b", type: "open",   position: 1, legacyStatus: "in_progress" },
  { name: "Blocked",     color: "#ef4444", type: "open",   position: 2, legacyStatus: "blocked" },
  { name: "Done",        color: "#10b981", type: "closed", position: 3, legacyStatus: "done" },
];

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Create the workflow_stages table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_stages (
        id          SERIAL PRIMARY KEY,
        org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        color       VARCHAR(7) NOT NULL DEFAULT '#6b7280',
        type        TEXT NOT NULL DEFAULT 'open' CHECK (type IN ('open', 'closed')),
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Create index for fast per-org lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS workflow_stages_org_id_idx ON workflow_stages (org_id, position);
    `);

    // 3. For every existing org, seed the four default stages if not already seeded
    const { rows: orgs } = await client.query<{ id: string }>(
      `SELECT id FROM organizations`,
    );

    for (const org of orgs) {
      // Skip if this org already has stages
      const { rows: existing } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM workflow_stages WHERE org_id = $1`,
        [org.id],
      );
      if (parseInt(existing[0].count, 10) > 0) continue;

      // Seed the four default stages and collect their IDs
      const stageIds: Record<string, number> = {};
      for (const stage of DEFAULT_STAGES) {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO workflow_stages (org_id, name, color, type, position)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [org.id, stage.name, stage.color, stage.type, stage.position],
        );
        stageIds[stage.legacyStatus] = rows[0].id;
      }

      // Backfill tasks for this org: map legacy status strings to stage IDs
      for (const [legacyStatus, stageId] of Object.entries(stageIds)) {
        await client.query(
          `UPDATE tasks SET status = $1 WHERE org_id = $2 AND status = $3`,
          [String(stageId), org.id, legacyStatus],
        );
      }

      // Any tasks with an unrecognized status fall back to the "To Do" stage
      const todoId = stageIds["todo"];
      if (todoId) {
        await client.query(
          `UPDATE tasks SET status = $1
           WHERE org_id = $2
             AND status NOT IN (${Object.values(stageIds).map((_, i) => `$${i + 3}`).join(", ")})`,
          [String(todoId), org.id, ...Object.values(stageIds).map(String)],
        );
      }
    }

    await client.query("COMMIT");
    console.log("Migration complete: workflow_stages table created and tasks backfilled.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
