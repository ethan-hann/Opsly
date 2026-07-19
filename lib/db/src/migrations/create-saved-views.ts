/**
 * Migration: create saved_views table.
 *
 * Purpose
 * -------
 * Saved views let users bookmark a named filter set and return to it with one
 * click. Views are personal by default but can be shared org-wide. One view
 * per user can be pinned as their default, loading automatically on /tasks.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-saved-views
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
    // 1. Create saved_views table if it doesn't exist
    const { rows: tableExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'saved_views'
      ) AS exists
    `);

    if (tableExists[0]?.exists) {
      console.log("Table saved_views already exists — skipping. ✓");
    } else {
      await pool.query(`
        CREATE TABLE saved_views (
          id          SERIAL PRIMARY KEY,
          org_id      VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          filters     JSONB NOT NULL DEFAULT '{}',
          is_org_wide BOOLEAN NOT NULL DEFAULT false,
          is_default  BOOLEAN NOT NULL DEFAULT false,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      console.log("Created table saved_views. ✓");
    }

    // 2. Add indexes for common query patterns
    await pool.query(`
      CREATE INDEX IF NOT EXISTS saved_views_org_id_idx
        ON saved_views (org_id);
    `);
    console.log("Index saved_views_org_id_idx ensured. ✓");

    await pool.query(`
      CREATE INDEX IF NOT EXISTS saved_views_created_by_idx
        ON saved_views (created_by);
    `);
    console.log("Index saved_views_created_by_idx ensured. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
