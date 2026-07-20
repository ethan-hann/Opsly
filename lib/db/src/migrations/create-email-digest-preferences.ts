/**
 * Migration: email digest preferences.
 *
 * Creates:
 *   - email_digest_frequency  (enum: none | daily | weekly)
 *   - email_digest_preferences (per-user digest frequency + lastSentAt)
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-email-digest-preferences
 *
 * Idempotent: safe to re-run.
 */

import pg from 'pg';

const { Pool } = pg;

async function typeExists(pool: pg.Pool, typeName: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_type WHERE typname = $1
     ) AS exists`,
    [typeName],
  );
  return rows[0]?.exists ?? false;
}

async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_name = $1
     ) AS exists`,
    [table],
  );
  return rows[0]?.exists ?? false;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── 1. email_digest_frequency enum ───────────────────────────────────────
    if (await typeExists(pool, 'email_digest_frequency')) {
      console.log('enum email_digest_frequency already exists — skipping. ✓');
    } else {
      await pool.query(`
        CREATE TYPE email_digest_frequency AS ENUM ('none', 'daily', 'weekly')
      `);
      console.log('Created enum email_digest_frequency. ✓');
    }

    // ── 2. email_digest_preferences table ────────────────────────────────────
    if (await tableExists(pool, 'email_digest_preferences')) {
      console.log('Table email_digest_preferences already exists — skipping. ✓');
    } else {
      await pool.query(`
        CREATE TABLE email_digest_preferences (
          id           SERIAL PRIMARY KEY,
          user_id      VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          frequency    email_digest_frequency NOT NULL DEFAULT 'none',
          last_sent_at TIMESTAMPTZ,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT email_digest_preferences_user_idx UNIQUE (user_id)
        )
      `);
      console.log('Created table email_digest_preferences. ✓');
    }

    console.log('\nMigration create-email-digest-preferences complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
