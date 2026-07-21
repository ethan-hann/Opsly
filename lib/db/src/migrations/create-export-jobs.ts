/**
 * Migration: create export_jobs table and export_job_status enum.
 *
 * This replaces the in-memory Map previously used to hold completed background
 * export files, making export tokens durable across API server restarts.
 *
 * Safe to re-run: all DDL statements use IF NOT EXISTS / IF EXISTS guards.
 */

import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create the status enum (idempotent).
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE export_job_status AS ENUM ('pending', 'complete', 'expired');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // 2. Create the export_jobs table (idempotent).
    await client.query(`
      CREATE TABLE IF NOT EXISTS export_jobs (
        id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id       VARCHAR       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id      VARCHAR       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token        VARCHAR(64)   NOT NULL,
        object_key   TEXT          NOT NULL,
        status       export_job_status NOT NULL DEFAULT 'pending',
        filename     VARCHAR(255)  NOT NULL,
        content_type VARCHAR(128)  NOT NULL,
        created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ   NOT NULL
      );
    `);

    // 3. Unique index on token (used by the download route for fast lookup).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_token_idx
        ON export_jobs (token);
    `);

    // 4. Unique index enforcing at most one active export per user+org.
    //    The application deletes the previous row before inserting a new one,
    //    so this constraint is always satisfiable.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_user_org_active_idx
        ON export_jobs (user_id, org_id);
    `);

    await client.query("COMMIT");
    console.log("Migration complete: export_jobs table and export_job_status enum created.");
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
