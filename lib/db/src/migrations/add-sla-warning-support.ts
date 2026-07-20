/**
 * Migration: add SLA warning webhook support.
 *
 * Purpose
 * -------
 * - tasks.sla_warning_sent_at   — tracks when the warning webhook was dispatched,
 *   preventing duplicate fires in the same breach cycle.
 * - sla_policies.warning_threshold_percent — configurable percentage of the resolution
 *   window at which the warning webhook fires (default 80, i.e. 80% elapsed).
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-sla-warning-support
 *
 * Idempotent: safe to re-run; uses ADD COLUMN IF NOT EXISTS.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 1. Add sla_warning_sent_at to tasks (nullable, initially null for all rows).
    await pool.query(`
      ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS sla_warning_sent_at TIMESTAMPTZ;
    `);

    // 2. Add warning_threshold_percent to sla_policies (default 80).
    await pool.query(`
      ALTER TABLE sla_policies
        ADD COLUMN IF NOT EXISTS warning_threshold_percent INTEGER NOT NULL DEFAULT 80;
    `);

    console.log(
      "Migration complete: sla_warning_sent_at added to tasks, " +
        "warning_threshold_percent added to sla_policies."
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
