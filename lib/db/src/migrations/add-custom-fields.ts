/**
 * Migration: add custom_field_definitions table and customFields JSONB column to tasks.
 *
 * Purpose
 * -------
 * Custom fields let org admins define typed metadata fields (text, number, date,
 * single_select, multi_select) that appear on every task in their org.
 * - `custom_field_definitions` stores the field schemas, soft-deletable via `deleted_at`.
 * - `custom_fields` JSONB on the tasks table stores per-task values keyed by field ID.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-custom-fields
 *
 * Idempotent: safe to re-run; skips steps that already exist.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 1. Create custom_field_definitions table if it doesn't exist
    const { rows: tableExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'custom_field_definitions'
      ) AS exists
    `);

    if (tableExists[0]?.exists) {
      console.log("Table custom_field_definitions already exists — skipping create. ✓");
    } else {
      await pool.query(`
        CREATE TABLE custom_field_definitions (
          id            SERIAL PRIMARY KEY,
          org_id        VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name          TEXT NOT NULL,
          type          TEXT NOT NULL,
          options       JSONB,
          position      INTEGER NOT NULL DEFAULT 0,
          deleted_at    TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      console.log("Created table custom_field_definitions. ✓");
    }

    // 2. Add custom_fields JSONB column to tasks if it doesn't exist
    const { rows: colExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'custom_fields'
      ) AS exists
    `);

    if (colExists[0]?.exists) {
      console.log("Column custom_fields already exists on tasks — skipping. ✓");
    } else {
      await pool.query(`
        ALTER TABLE tasks
          ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}'
      `);
      console.log("Added custom_fields JSONB column to tasks. ✓");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
