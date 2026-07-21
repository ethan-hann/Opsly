/**
 * Migration: create instance_smtp_config table.
 *
 * Single-row table (id = 'default') that holds a live SMTP configuration
 * override. When a row is present the API server uses it over environment
 * variables. The SMTP password is stored AES-256-GCM encrypted.
 *
 * Safe to re-run: uses IF NOT EXISTS guard.
 */

import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS instance_smtp_config (
        id            TEXT        PRIMARY KEY DEFAULT 'default',
        host          TEXT        NOT NULL,
        port          TEXT        NOT NULL,
        secure        BOOLEAN     NOT NULL DEFAULT FALSE,
        "user"        TEXT        NOT NULL DEFAULT '',
        pass_encrypted TEXT,
        from_address  TEXT        NOT NULL,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query("COMMIT");
    console.log("Migration complete: instance_smtp_config table created.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
