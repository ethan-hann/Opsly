/**
 * Migration: add rate_limit_per_minute column to inbound_webhooks.
 *
 * Purpose
 * -------
 * The ingest endpoint now enforces a per-webhook sliding-window rate limit.
 * This column stores the maximum number of tasks a webhook may create in any
 * rolling 60-second window.  Default is 60 (1/sec average), which is generous
 * for legitimate alerting systems and acts as a circuit-breaker for runaway ones.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-inbound-webhook-rate-limit
 *
 * The migration is idempotent: it skips the ALTER TABLE when the column already
 * exists, so it is safe to run multiple times or in CI.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Check whether the column already exists so the script stays idempotent.
    const { rows } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM   information_schema.columns
        WHERE  table_name  = 'inbound_webhooks'
          AND  column_name = 'rate_limit_per_minute'
      ) AS exists
    `);

    if (rows[0]?.exists) {
      console.log("Column rate_limit_per_minute already exists — nothing to do. ✓");
      return;
    }

    await pool.query(`
      ALTER TABLE inbound_webhooks
        ADD COLUMN rate_limit_per_minute integer NOT NULL DEFAULT 60
    `);

    console.log("Added rate_limit_per_minute (default 60) to inbound_webhooks. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
