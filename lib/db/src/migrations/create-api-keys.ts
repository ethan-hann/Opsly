/**
 * Migration: create api_keys table and make webhook created_by nullable.
 *
 * Purpose
 * -------
 * The api_keys table stores named, scoped machine credentials for programmatic
 * API access. Each key has:
 *   - A bcrypt-resistant SHA-256 hash of the full key value (never the key itself)
 *   - An 8-character prefix for identification in the UI
 *   - A scopes array limiting what the key can do
 *   - Optional expiry and revocation timestamps
 *
 * Additionally, the inbound_webhooks and outbound_webhooks tables have their
 * created_by column made nullable so that API-key-created webhooks (which have
 * no associated user) can be persisted.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-api-keys
 *
 * Idempotent: safe to re-run.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── 1. Create api_keys table ─────────────────────────────────────────────
    const { rows: tableExists } = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'api_keys'
      ) AS exists
    `);

    if (tableExists[0]?.exists) {
      console.log("Table api_keys already exists — skipping. ✓");
    } else {
      await pool.query(`
        CREATE TABLE api_keys (
          id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          org_id     VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name       TEXT NOT NULL,
          key_prefix VARCHAR(8) NOT NULL,
          key_hash   VARCHAR(64) NOT NULL UNIQUE,
          scopes     TEXT[] NOT NULL DEFAULT '{}',
          expires_at TIMESTAMPTZ,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ
        )
      `);
      console.log("Created table api_keys. ✓");

      // Index for fast lookup by org (list all keys for an org)
      await pool.query(`
        CREATE INDEX api_keys_org_id_idx ON api_keys (org_id)
      `);
      console.log("Created index api_keys_org_id_idx. ✓");
    }

    // ── 2. Make inbound_webhooks.created_by nullable ─────────────────────────
    const { rows: inboundNotNull } = await pool.query<{ is_nullable: string }>(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'inbound_webhooks' AND column_name = 'created_by'
    `);

    if (inboundNotNull[0]?.is_nullable === "YES") {
      console.log("inbound_webhooks.created_by already nullable — skipping. ✓");
    } else {
      await pool.query(`
        ALTER TABLE inbound_webhooks
        ALTER COLUMN created_by DROP NOT NULL
      `);
      console.log("Made inbound_webhooks.created_by nullable. ✓");
    }

    // ── 3. Make outbound_webhooks.created_by nullable ────────────────────────
    const { rows: outboundNotNull } = await pool.query<{ is_nullable: string }>(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'outbound_webhooks' AND column_name = 'created_by'
    `);

    if (outboundNotNull[0]?.is_nullable === "YES") {
      console.log("outbound_webhooks.created_by already nullable — skipping. ✓");
    } else {
      await pool.query(`
        ALTER TABLE outbound_webhooks
        ALTER COLUMN created_by DROP NOT NULL
      `);
      console.log("Made outbound_webhooks.created_by nullable. ✓");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
