/**
 * Migration: backfill delete_comments permission into existing roles.
 *
 * Purpose
 * -------
 * Adds the new `delete_comments` permission key to all existing roles
 * in the `roles.permissions` JSONB column:
 *   - Owner roles                   → true
 *   - Admin built-in roles          → true
 *   - Member built-in + custom roles → false
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-delete-comments-permission
 *
 * The migration is idempotent: rows that already have the key are skipped.
 */

import pg from 'pg';

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── Owner roles: delete_comments = true ────────────────────────────────
    const { rowCount: ownerUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"delete_comments": true}'::jsonb
      WHERE is_owner = TRUE
        AND (permissions->>'delete_comments') IS NULL
    `);
    console.log(`Updated ${ownerUpdated ?? 0} Owner role(s) → delete_comments: true ✓`);

    // ── Admin built-in roles: delete_comments = true ───────────────────────
    const { rowCount: adminUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"delete_comments": true}'::jsonb
      WHERE is_built_in = TRUE
        AND is_owner = FALSE
        AND name = 'Admin'
        AND (permissions->>'delete_comments') IS NULL
    `);
    console.log(`Updated ${adminUpdated ?? 0} Admin role(s) → delete_comments: true ✓`);

    // ── All other roles (Member + custom): delete_comments = false ─────────
    const { rowCount: memberUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"delete_comments": false}'::jsonb
      WHERE is_owner = FALSE
        AND (name != 'Admin' OR is_built_in = FALSE)
        AND (permissions->>'delete_comments') IS NULL
    `);
    console.log(`Updated ${memberUpdated ?? 0} Member/custom role(s) → delete_comments: false ✓`);

    console.log('\nMigration complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
