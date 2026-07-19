/**
 * Idempotent migration: creates the outbound_webhook_deliveries table.
 * Run with: pnpm --filter @workspace/db migrate:add-outbound-webhook-deliveries
 */
import { Pool } from "pg";

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
        id            SERIAL PRIMARY KEY,
        webhook_id    INTEGER NOT NULL
                        REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
        event         TEXT NOT NULL,
        url           TEXT NOT NULL,
        status_code   INTEGER,
        success       BOOLEAN NOT NULL,
        duration_ms   INTEGER NOT NULL,
        error         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_owd_webhook_id_created_at
        ON outbound_webhook_deliveries (webhook_id, created_at DESC);
    `);
    console.log("Migration applied: outbound_webhook_deliveries table ready.");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
