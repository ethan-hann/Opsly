/**
 * Migration: instance admin console.
 *
 * Creates:
 *   - users.is_instance_admin       (boolean, default false)
 *   - organizations.is_disabled      (boolean, default false)
 *   - org_features                   (per-org feature flag table)
 *   - instance_audit_log             (audit trail for admin actions)
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-instance-admin
 *
 * Idempotent: safe to re-run.
 */

import pg from 'pg';

const { Pool } = pg;

async function columnExists(
  pool: pg.Pool,
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
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
    // ── 1. users.is_instance_admin ───────────────────────────────────────────
    if (await columnExists(pool, 'users', 'is_instance_admin')) {
      console.log('users.is_instance_admin already exists — skipping. ✓');
    } else {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN is_instance_admin BOOLEAN NOT NULL DEFAULT FALSE
      `);
      console.log('Added users.is_instance_admin. ✓');
    }

    // ── 2. organizations.is_disabled ─────────────────────────────────────────
    if (await columnExists(pool, 'organizations', 'is_disabled')) {
      console.log('organizations.is_disabled already exists — skipping. ✓');
    } else {
      await pool.query(`
        ALTER TABLE organizations
        ADD COLUMN is_disabled BOOLEAN NOT NULL DEFAULT FALSE
      `);
      console.log('Added organizations.is_disabled. ✓');
    }

    // ── 3. org_features table ────────────────────────────────────────────────
    if (await tableExists(pool, 'org_features')) {
      console.log('Table org_features already exists — skipping. ✓');
    } else {
      await pool.query(`
        CREATE TABLE org_features (
          id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          feature    TEXT NOT NULL,
          enabled    BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT org_features_org_id_feature_uniq UNIQUE (org_id, feature)
        )
      `);
      await pool.query(`
        CREATE INDEX org_features_org_id_idx ON org_features (org_id)
      `);
      console.log('Created table org_features. ✓');
    }

    // ── 4. instance_audit_log table ──────────────────────────────────────────
    if (await tableExists(pool, 'instance_audit_log')) {
      console.log('Table instance_audit_log already exists — skipping. ✓');
    } else {
      await pool.query(`
        CREATE TABLE instance_audit_log (
          id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          actor       TEXT NOT NULL,
          action      TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id   TEXT NOT NULL,
          metadata    JSONB,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX instance_audit_log_created_at_idx ON instance_audit_log (created_at DESC)
      `);
      console.log('Created table instance_audit_log. ✓');
    }

    console.log('\nMigration create-instance-admin complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
