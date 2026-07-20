/**
 * Migration: add GIN trigram indexes for fast ILIKE search.
 *
 * Purpose
 * -------
 * The global search endpoint (GET /search) uses ILIKE '%query%' patterns on
 * tasks.title, projects.name, notes.title, and notes.content. Without an index,
 * PostgreSQL performs a full sequential scan on every search request. As orgs
 * accumulate thousands of rows this becomes noticeably slow.
 *
 * The pg_trgm extension breaks text into 3-character grams and stores them in a
 * GIN (Generalised Inverted Index). PostgreSQL can then resolve ILIKE '%x%'
 * patterns against the index rather than scanning every row, keeping searches
 * under ~50ms even on large tables.
 *
 * Indexes created
 * ---------------
 *   tasks_title_trgm_idx     — GIN on tasks.title
 *   projects_name_trgm_idx   — GIN on projects.name
 *   notes_title_trgm_idx     — GIN on notes.title
 *   notes_content_trgm_idx   — GIN on notes.content
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-search-trigram-indexes
 *
 * Idempotent: safe to re-run (uses CREATE EXTENSION IF NOT EXISTS and
 * CREATE INDEX IF NOT EXISTS).
 *
 * Notes for future developers
 * ---------------------------
 * The search route (artifacts/api-server/src/routes/search.ts) relies on these
 * indexes for performance. If you change the searched columns or switch away
 * from ILIKE, update or drop the corresponding index to avoid maintaining
 * dead weight.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 1. Enable pg_trgm — required for gin_trgm_ops operator class.
    //    IF NOT EXISTS makes this safe to re-run.
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    console.log("pg_trgm extension enabled.");

    // 2. GIN trigram index on tasks.title
    await pool.query(`
      CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx
        ON tasks USING GIN (title gin_trgm_ops);
    `);
    console.log("Created index: tasks_title_trgm_idx");

    // 3. GIN trigram index on projects.name
    await pool.query(`
      CREATE INDEX IF NOT EXISTS projects_name_trgm_idx
        ON projects USING GIN (name gin_trgm_ops);
    `);
    console.log("Created index: projects_name_trgm_idx");

    // 4. GIN trigram index on notes.title
    await pool.query(`
      CREATE INDEX IF NOT EXISTS notes_title_trgm_idx
        ON notes USING GIN (title gin_trgm_ops);
    `);
    console.log("Created index: notes_title_trgm_idx");

    // 5. GIN trigram index on notes.content
    //    Content can be long HTML; the index covers the full text so that
    //    ILIKE on content also benefits from the index scan.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS notes_content_trgm_idx
        ON notes USING GIN (content gin_trgm_ops);
    `);
    console.log("Created index: notes_content_trgm_idx");

    console.log(
      "\nMigration complete: pg_trgm enabled, GIN trigram indexes created on " +
        "tasks.title, projects.name, notes.title, notes.content."
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
