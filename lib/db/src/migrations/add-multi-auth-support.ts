/**
 * Migration: add multi-auth user fields for OIDC + local credentials.
 *
 * Adds:
 *  - users.auth_provider
 *  - users.external_auth_id
 *  - users.password_hash
 *  - unique index on (auth_provider, external_auth_id)
 *
 * Backfills existing OIDC users so external_auth_id = users.id where missing.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-multi-auth-support
 */

import pg from 'pg';

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'oidc'
    `);
    console.log('Ensured users.auth_provider exists. ✓');

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS external_auth_id VARCHAR
    `);
    console.log('Ensured users.external_auth_id exists. ✓');

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash VARCHAR
    `);
    console.log('Ensured users.password_hash exists. ✓');

    await pool.query(`
      UPDATE users
      SET external_auth_id = id
      WHERE auth_provider = 'oidc'
        AND external_auth_id IS NULL
    `);
    console.log('Backfilled users.external_auth_id for OIDC users. ✓');

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_external_auth_id_idx
      ON users (auth_provider, external_auth_id)
    `);
    console.log('Ensured users_auth_provider_external_auth_id_idx exists. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
