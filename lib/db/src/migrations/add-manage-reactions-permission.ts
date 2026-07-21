/**
 * Migration: backfill manage_reactions permission into existing roles.
 *
 * Purpose
 * -------
 * Adds the new `manage_reactions` permission key to all existing roles
 * in the `roles.permissions` JSONB column:
 *   - Owner roles                    → true
 *   - Admin built-in roles           → true
 *   - Member built-in + custom roles → false
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-manage-reactions-permission
 *
 * Idempotent: rows that already have the key are skipped.
 */

import pg from 'pg';

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── Owner roles: manage_reactions = true ──────────────────────────────────
    const { rowCount: ownerUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"manage_reactions": true}'::jsonb
      WHERE is_owner = TRUE
        AND (permissions->>'manage_reactions') IS NULL
    `);
    console.log(`Updated ${ownerUpdated ?? 0} Owner role(s) → manage_reactions: true ✓`);

    // ── Admin built-in roles: manage_reactions = true ─────────────────────────
    const { rowCount: adminUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"manage_reactions": true}'::jsonb
      WHERE is_built_in = TRUE
        AND is_owner = FALSE
        AND name = 'Admin'
        AND (permissions->>'manage_reactions') IS NULL
    `);
    console.log(`Updated ${adminUpdated ?? 0} Admin role(s) → manage_reactions: true ✓`);

    // ── All other roles (Member + custom): manage_reactions = false ───────────
    const { rowCount: memberUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"manage_reactions": false}'::jsonb
      WHERE is_owner = FALSE
        AND (name != 'Admin' OR is_built_in = FALSE)
        AND (permissions->>'manage_reactions') IS NULL
    `);
    console.log(`Updated ${memberUpdated ?? 0} Member/custom role(s) → manage_reactions: false ✓`);

    console.log('\nMigration complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
