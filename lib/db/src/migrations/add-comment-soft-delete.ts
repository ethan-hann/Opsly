/**
 * Migration: add deleted_at column to comments table for soft-delete support.
 *
 * When a comment with replies is deleted, setting deleted_at preserves the
 * row so child comments remain anchored. The API masks content/author/userId
 * for soft-deleted comments and returns deleted:true so the client can render
 * a Reddit-style "This comment was deleted." tombstone.
 *
 * Run once:
 *   DATABASE_URL=... npx tsx lib/db/src/migrations/add-comment-soft-delete.ts
 *   # or:
 *   pnpm --filter @workspace/db migrate:add-comment-soft-delete
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
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `);
    console.log("Migration: added deleted_at column to comments table. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
