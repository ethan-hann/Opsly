/**
 * Migration: add user_id column to comments table.
 *
 * Tracks which authenticated user created each comment server-side so
 * the DELETE route can enforce ownership (author or org admin).
 *
 * The column is NULLABLE so existing rows (where creator is unknown) are
 * preserved without forced backfill. On delete, null userId means we fall
 * back to the admin-only path.
 *
 * Run once:
 *   DATABASE_URL=... npx tsx lib/db/src/migrations/add-comment-user-id.ts
 *   # or:
 *   pnpm --filter @workspace/db migrate:add-comment-user-id
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
        ADD COLUMN IF NOT EXISTS user_id TEXT
    `);
    console.log("Migration: added user_id column to comments table. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
