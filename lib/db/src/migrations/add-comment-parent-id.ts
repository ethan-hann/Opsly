/**
 * Migration: add parent_id column to comments table for threaded replies.
 *
 * Self-referential FK so replies are cascaded when the parent comment is
 * deleted. NULL means the comment is a top-level comment.
 *
 * Run once:
 *   DATABASE_URL=... npx tsx lib/db/src/migrations/add-comment-parent-id.ts
 *   # or:
 *   pnpm --filter @workspace/db migrate:add-comment-parent-id
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
        ADD COLUMN IF NOT EXISTS parent_id INTEGER
          REFERENCES comments(id) ON DELETE CASCADE
    `);
    console.log("Migration: added parent_id column to comments table. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
