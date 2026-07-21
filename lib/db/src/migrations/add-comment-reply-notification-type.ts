/**
 * Migration: add 'comment_reply' value to the notification_type enum.
 *
 * Sent to the author of a parent comment when someone posts a reply.
 * The `IF NOT EXISTS` guard makes this migration safe to re-run on databases
 * that already have the value (e.g. after a drizzle push on a dev DB).
 *
 * Run once:
 *   DATABASE_URL=... npx tsx lib/db/src/migrations/add-comment-reply-notification-type.ts
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
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'comment_reply'
    `);
    console.log("Migration: added 'comment_reply' to notification_type enum. ✓");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
