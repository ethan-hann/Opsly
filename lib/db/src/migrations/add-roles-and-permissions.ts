/**
 * Migration: add granular roles & permissions system.
 *
 * Purpose
 * -------
 * Replaces the binary admin/member enum on org_members with a first-class
 * `roles` table.  Each org gets three built-in roles seeded automatically:
 *   - Owner   (all permissions, immutable)
 *   - Admin   (all permissions, configurable by Owner)
 *   - Member  (basic read/write, configurable by Owner)
 *
 * Existing admins are mapped → Owner; existing members → Member.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-roles-and-permissions
 *
 * The migration is idempotent: every step checks current DB state before
 * applying, so it is safe to run multiple times.
 */

import pg from 'pg';

const { Pool } = pg;

const OWNER_PERMISSIONS = JSON.stringify({
  view_tasks: true,
  create_tasks: true,
  edit_tasks: true,
  close_tasks: true,
  delete_tasks: true,
  manage_projects: true,
  manage_org_settings: true,
  manage_members: true,
  manage_webhooks: true,
  manage_api_keys: true,
  manage_custom_fields: true,
  manage_workflow_stages: true,
  manage_sla_policies: true,
  manage_task_templates: true,
  manage_saved_views: true,
  view_audit_log: true,
});

const ADMIN_PERMISSIONS = OWNER_PERMISSIONS;

const MEMBER_PERMISSIONS = JSON.stringify({
  view_tasks: true,
  create_tasks: true,
  edit_tasks: true,
  close_tasks: true,
  delete_tasks: false,
  manage_projects: false,
  manage_org_settings: false,
  manage_members: false,
  manage_webhooks: false,
  manage_api_keys: false,
  manage_custom_fields: false,
  manage_workflow_stages: false,
  manage_sla_policies: false,
  manage_task_templates: false,
  manage_saved_views: false,
  view_audit_log: false,
});

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── Step 1: Create roles table ──────────────────────────────────────────
    const { rows: tableExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'roles'
      ) AS exists
    `);

    if (!tableExists[0]?.exists) {
      await pool.query(`
        CREATE TABLE roles (
          id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          org_id    VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name      TEXT NOT NULL,
          is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
          is_owner  BOOLEAN NOT NULL DEFAULT FALSE,
          permissions JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);
      console.log('Created roles table. ✓');
    } else {
      console.log('roles table already exists — skipping. ✓');
    }

    // ── Step 2: Seed built-in roles for each org that doesn't have them yet ─
    const { rows: orgs } = await pool.query<{ id: string }>(`SELECT id FROM organizations`);

    for (const org of orgs) {
      // Check which built-in roles exist
      const { rows: existing } = await pool.query<{ name: string }>(
        `SELECT name FROM roles WHERE org_id = $1 AND is_built_in = TRUE`,
        [org.id],
      );
      const existingNames = new Set(existing.map((r) => r.name));

      if (!existingNames.has('Owner')) {
        await pool.query(
          `INSERT INTO roles (org_id, name, is_built_in, is_owner, permissions)
           VALUES ($1, 'Owner', TRUE, TRUE, $2::jsonb)`,
          [org.id, OWNER_PERMISSIONS],
        );
      }
      if (!existingNames.has('Admin')) {
        await pool.query(
          `INSERT INTO roles (org_id, name, is_built_in, is_owner, permissions)
           VALUES ($1, 'Admin', TRUE, FALSE, $2::jsonb)`,
          [org.id, ADMIN_PERMISSIONS],
        );
      }
      if (!existingNames.has('Member')) {
        await pool.query(
          `INSERT INTO roles (org_id, name, is_built_in, is_owner, permissions)
           VALUES ($1, 'Member', TRUE, FALSE, $2::jsonb)`,
          [org.id, MEMBER_PERMISSIONS],
        );
      }
    }
    console.log(`Seeded built-in roles for ${orgs.length} org(s). ✓`);

    // ── Step 3: Add role_id column to org_members (nullable) ───────────────
    const { rows: colExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'org_members' AND column_name = 'role_id'
      ) AS exists
    `);

    if (!colExists[0]?.exists) {
      await pool.query(`
        ALTER TABLE org_members
          ADD COLUMN role_id TEXT REFERENCES roles(id) ON DELETE RESTRICT
      `);
      console.log('Added role_id column to org_members. ✓');
    } else {
      console.log('role_id column already exists — skipping. ✓');
    }

    // ── Step 4: Backfill role_id from existing role enum ───────────────────
    const { rows: needsBackfill } = await pool.query<{ count: string }>(`
      SELECT count(*)::int AS count FROM org_members WHERE role_id IS NULL
    `);

    if (Number(needsBackfill[0]?.count) > 0) {
      // Admins → Owner role
      await pool.query(`
        UPDATE org_members om
        SET role_id = (
          SELECT r.id FROM roles r
          WHERE r.org_id = om.org_id AND r.is_owner = TRUE
          LIMIT 1
        )
        WHERE om.role = 'admin' AND om.role_id IS NULL
      `);

      // Members → Member role
      await pool.query(`
        UPDATE org_members om
        SET role_id = (
          SELECT r.id FROM roles r
          WHERE r.org_id = om.org_id AND r.name = 'Member' AND r.is_built_in = TRUE
          LIMIT 1
        )
        WHERE om.role = 'member' AND om.role_id IS NULL
      `);

      // Safety: any remaining nulls → Member role
      await pool.query(`
        UPDATE org_members om
        SET role_id = (
          SELECT r.id FROM roles r
          WHERE r.org_id = om.org_id AND r.name = 'Member' AND r.is_built_in = TRUE
          LIMIT 1
        )
        WHERE om.role_id IS NULL
      `);

      console.log('Backfilled role_id for existing members. ✓');
    } else {
      console.log('All role_id values already set — skipping backfill. ✓');
    }

    // ── Step 5: Make role_id NOT NULL ──────────────────────────────────────
    const { rows: nullable } = await pool.query<{ is_nullable: string }>(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'org_members' AND column_name = 'role_id'
    `);

    if (nullable[0]?.is_nullable === 'YES') {
      await pool.query(`
        ALTER TABLE org_members ALTER COLUMN role_id SET NOT NULL
      `);
      console.log('Made role_id NOT NULL. ✓');
    } else {
      console.log('role_id is already NOT NULL — skipping. ✓');
    }

    // ── Step 6: Drop old role column (if it still exists) ──────────────────
    const { rows: roleColExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'org_members' AND column_name = 'role'
      ) AS exists
    `);

    if (roleColExists[0]?.exists) {
      await pool.query(`ALTER TABLE org_members DROP COLUMN role`);
      console.log('Dropped old role column from org_members. ✓');
    } else {
      console.log('Old role column already gone — skipping. ✓');
    }

    // ── Step 7: Drop the org_role enum type ────────────────────────────────
    const { rows: enumExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'org_role'
      ) AS exists
    `);

    if (enumExists[0]?.exists) {
      await pool.query(`DROP TYPE org_role`);
      console.log('Dropped org_role enum type. ✓');
    } else {
      console.log('org_role enum already gone — skipping. ✓');
    }

    console.log('\nMigration complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
