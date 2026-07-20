/**
 * Migration: add project-level SLA policy overrides.
 *
 * Purpose
 * -------
 * The original sla_policies table had UNIQUE (org_id, priority), which only
 * allowed one row per priority per org.  This migration replaces that with two
 * partial unique indexes so that org-level defaults and per-project overrides
 * can coexist in the same table:
 *
 *   sla_policies_org_priority_uniq         — UNIQUE (org_id, priority) WHERE project_id IS NULL
 *   sla_policies_org_project_priority_uniq — UNIQUE (org_id, project_id, priority) WHERE project_id IS NOT NULL
 *
 * It also adds the project_id FK column if it was not already present (e.g.
 * environments that never ran drizzle-kit push after the schema change).
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-project-sla-overrides
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
    // 1. Add project_id column if not already present.
    await pool.query(`
      ALTER TABLE sla_policies
        ADD COLUMN IF NOT EXISTS project_id INTEGER
          REFERENCES projects(id) ON DELETE CASCADE;
    `);

    // 2. Drop the old scalar unique constraint if it still exists.
    //    PostgreSQL auto-names inline UNIQUE constraints as <table>_<cols>_key.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname  = 'sla_policies_org_id_priority_key'
             AND contype  = 'u'
             AND conrelid = 'sla_policies'::regclass
        ) THEN
          ALTER TABLE sla_policies DROP CONSTRAINT sla_policies_org_id_priority_key;
        END IF;
      END $$;
    `);

    // 3. Create partial unique index for org-level rows (project_id IS NULL).
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS sla_policies_org_priority_uniq
        ON sla_policies (org_id, priority)
        WHERE project_id IS NULL;
    `);

    // 4. Create partial unique index for project-level rows (project_id IS NOT NULL).
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS sla_policies_org_project_priority_uniq
        ON sla_policies (org_id, project_id, priority)
        WHERE project_id IS NOT NULL;
    `);

    console.log(
      "Migration complete: project_id added, old UNIQUE constraint replaced " +
        "with partial unique indexes for org-level and project-level SLA policies."
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
