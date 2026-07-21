/**
 * Migration: add edited_at column to comments table.
 *
 * Purpose
 * -------
 * Tracks when a comment was last edited. NULL means the comment has never been
 * edited. The client uses the presence of this value to show an "(edited)" label.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-comment-edited-at
 *
 * The migration is idempotent: the ADD COLUMN IF NOT EXISTS guard makes it safe
 * to run multiple times.
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
      ALTER TABLE comments
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ
    `);
    console.log("Migration: added edited_at column to comments table. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
