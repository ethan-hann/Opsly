/**
 * Migration: add branding columns to organizations table.
 *
 * Purpose
 * -------
 * Adds `primary_color` (varchar(7), nullable) and `logo_url` (text, nullable)
 * to the organizations table to support white-label branding per org.
 * A check constraint enforces that primary_color, when set, matches the
 * 6-digit hex format (#rrggbb).
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-org-branding
 *
 * Idempotent: safe to re-run; uses ADD COLUMN IF NOT EXISTS.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7)
          CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$'),
        ADD COLUMN IF NOT EXISTS logo_url TEXT;
    `);

    console.log("Migration complete: primary_color and logo_url added to organizations.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
