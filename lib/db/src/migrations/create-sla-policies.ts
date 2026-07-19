/**
 * Migration: create sla_policies table and add sla_breached_at to tasks.
 *
 * Purpose
 * -------
 * sla_policies stores per-org, per-priority response and resolution time
 * targets.  sla_breached_at on tasks records the timestamp when a resolution
 * SLA breach was first detected so breach webhooks fire only once.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-sla-policies
 *
 * Idempotent: safe to re-run; uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
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
      CREATE TABLE IF NOT EXISTS sla_policies (
        id                  SERIAL PRIMARY KEY,
        org_id              TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        priority            TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
        response_minutes    INTEGER CHECK (response_minutes > 0),
        resolution_minutes  INTEGER CHECK (resolution_minutes > 0),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, priority)
      );
    `);

    await pool.query(`
      ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ;
    `);

    console.log("Migration complete: sla_policies table created, sla_breached_at added to tasks.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
