/**
 * Migration: add digest_claimed_at to email_digest_preferences.
 *
 * Adds the column used by the digest mailer's claim pattern to prevent
 * duplicate emails when the server restarts mid-send.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-digest-claimed-at
 *
 * Idempotent: safe to re-run (uses ADD COLUMN IF NOT EXISTS).
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

  try {
    await pool.query(`
      ALTER TABLE email_digest_preferences
        ADD COLUMN IF NOT EXISTS digest_claimed_at TIMESTAMPTZ
    `);
    console.log("email_digest_preferences.digest_claimed_at ensured. ✓");

    console.log("\nMigration add-digest-claimed-at complete. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
