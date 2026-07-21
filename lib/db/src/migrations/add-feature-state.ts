/**
 * Migration: add feature_state column to org_features table.
 *
 * The existing `enabled` boolean is kept for backward compatibility with the
 * admin console API. The new `feature_state` text column is the source of truth
 * for the three-state flag: 'enabled' | 'disabled' | 'unsubscribed'.
 *
 * Backfill: rows with enabled=true → 'enabled', enabled=false → 'disabled'.
 */

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add the column (idempotent: skip if already exists)
    await client.query(`
      ALTER TABLE org_features
      ADD COLUMN IF NOT EXISTS feature_state TEXT NOT NULL DEFAULT 'enabled'
    `);

    // Backfill from the existing boolean
    await client.query(`
      UPDATE org_features
      SET feature_state = CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END
      WHERE feature_state = 'enabled' AND enabled = FALSE
    `);

    await client.query('COMMIT');
    console.log('Migration complete: feature_state column added to org_features.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
