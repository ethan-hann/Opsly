/**
 * Migration: create comment_reactions table.
 *
 * Purpose
 * -------
 * Adds the `comment_reactions` table to support per-user emoji reactions on
 * comments. Each row records one user reacting with one emoji on one comment.
 * A unique constraint prevents duplicate reactions from the same user.
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:create-comment-reactions
 *
 * Idempotent: uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 */

import pg from 'pg';

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comment_reactions (
        id          SERIAL PRIMARY KEY,
        org_id      VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL,
        emoji       VARCHAR(64) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT comment_reactions_unique UNIQUE (comment_id, user_id, emoji)
      )
    `);
    console.log('Created comment_reactions table ✓');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS comment_reactions_comment_id_idx
        ON comment_reactions (comment_id)
    `);
    console.log('Created index on comment_reactions.comment_id ✓');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS comment_reactions_org_id_idx
        ON comment_reactions (org_id)
    `);
    console.log('Created index on comment_reactions.org_id ✓');

    console.log('\nMigration complete. ✓');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
