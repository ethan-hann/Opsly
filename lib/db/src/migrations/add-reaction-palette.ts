/**
 * Migration: add reaction_palette JSONB column to organizations.
 *
 * Purpose
 * -------
 * Adds a nullable `reaction_palette` column (JSONB, array of emoji strings) to
 * the `organizations` table. NULL means the org uses the system default palette.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-reaction-palette
 *
 * Idempotent: no-op when the column already exists.
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
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS reaction_palette JSONB
    `);
    console.log('Added reaction_palette column to organizations ✓');

    console.log('\nMigration complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
