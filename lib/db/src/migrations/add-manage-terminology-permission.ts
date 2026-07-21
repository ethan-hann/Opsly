/**
 * Migration: backfill manage_terminology permission into existing roles.
 *
 * Purpose
 * -------
 * Adds the new `manage_terminology` permission key to all existing roles
 * in the `roles.permissions` JSONB column:
 *   - Owner / Admin built-in roles → true
 *   - Member built-in role         → false
 *   - Custom roles                 → false (conservative default; org owners can adjust)
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-manage-terminology-permission
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
    // ── Owner roles: manage_terminology = true ──────────────────────────────
    const { rowCount: ownerUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"manage_terminology": true}'::jsonb
      WHERE is_owner = TRUE
        AND (permissions->>'manage_terminology') IS NULL
    `);
    console.log(`Updated ${ownerUpdated ?? 0} Owner role(s) → manage_terminology: true ✓`);

    // ── Admin built-in roles: manage_terminology = true ─────────────────────
    const { rowCount: adminUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"manage_terminology": true}'::jsonb
      WHERE is_built_in = TRUE
        AND is_owner = FALSE
        AND name = 'Admin'
        AND (permissions->>'manage_terminology') IS NULL
    `);
    console.log(`Updated ${adminUpdated ?? 0} Admin role(s) → manage_terminology: true ✓`);

    // ── All other roles (Member + custom): manage_terminology = false ────────
    const { rowCount: memberUpdated } = await pool.query(`
      UPDATE roles
      SET permissions = permissions || '{"manage_terminology": false}'::jsonb
      WHERE is_owner = FALSE
        AND (name != 'Admin' OR is_built_in = FALSE)
        AND (permissions->>'manage_terminology') IS NULL
    `);
    console.log(`Updated ${memberUpdated ?? 0} Member/custom role(s) → manage_terminology: false ✓`);

    console.log('\nMigration complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
