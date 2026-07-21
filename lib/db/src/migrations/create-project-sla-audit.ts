/**
 * Migration: create project_sla_policy_audit table.
 *
 * Purpose
 * -------
 * Records an immutable audit trail whenever project-level SLA policy overrides
 * are replaced via PUT /projects/:id/sla-policies. Each row captures the actor,
 * timestamp, projectId, and JSON snapshots of the policies before and after.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-project-sla-audit
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_sla_policy_audit (
        id                  SERIAL PRIMARY KEY,
        org_id              VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        actor_id            TEXT,
        actor_name          TEXT,
        previous_policies   JSONB NOT NULL,
        new_policies        JSONB NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("Migration complete: project_sla_policy_audit table created (or already existed). ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
