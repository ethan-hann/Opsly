/**
 * Migration: add 'export_ready' value to the notification_type enum.
 *
 * Used to notify org admins when a large-org background data export finishes.
 * The `IF NOT EXISTS` guard makes this migration safe to re-run on databases
 * that already have the value (e.g. after a drizzle push on a dev DB).
 *
 * Run once:
 *   DATABASE_URL=... npx tsx lib/db/src/migrations/add-export-ready-notification-type.ts
 *   # or add to package.json scripts and run via pnpm
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ALTER TYPE … ADD VALUE IF NOT EXISTS is idempotent and safe to run on
    // databases that already have the value (e.g. after drizzle push on dev).
    await pool.query(`
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'export_ready'
    `);
    console.log("Migration: added 'export_ready' to notification_type enum. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
