/**
 * Backfill migration: populate comments.org_id from parent task's org_id.
 *
 * Three-phase rollout
 * -------------------
 * This script is Phase 2 of a safe, zero-downtime rollout for the
 * `comments.org_id` column:
 *
 *   Phase 1 — Add nullable column (already deployed)
 *     The column was added as NULLABLE with a FK reference to organizations.
 *     Existing rows have org_id = NULL. Route-level code handles NULLs by
 *     falling back to task-join scoping, so existing comments remain visible.
 *
 *   Phase 2 — Backfill (this script)
 *     Run AFTER Phase 1 is deployed and before Phase 3.
 *     Copies org_id from the parent task to every comment row where it is NULL.
 *
 *     DATABASE_URL=... npx tsx lib/db/src/migrations/backfill-comments-org-id.ts
 *     # or via npm script:
 *     pnpm --filter @workspace/db migrate:backfill-comments-org-id
 *
 *     The script is idempotent: rows that already have org_id set are skipped.
 *     Verify success: zero rows should remain with org_id IS NULL after the run.
 *
 *   Phase 3 — Enforce NOT NULL (follow-up deploy, after backfill is complete)
 *     Once every row has org_id set, change the schema to `.notNull()` and run
 *     `pnpm --filter @workspace/db push` (or generate and apply a migration).
 *     At that point the NULL-fallback branches in routes/comments.ts can also
 *     be removed.
 *
 * The script exits 0 on success, non-zero on error.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Update only rows where org_id is still NULL so the script is idempotent.
    const result = await pool.query(`
      UPDATE comments c
      SET    org_id = t.org_id
      FROM   tasks t
      WHERE  c.task_id   = t.id
        AND  c.org_id    IS NULL
        AND  t.org_id    IS NOT NULL
    `);

    console.log(`Backfilled ${result.rowCount} comment row(s) with org_id.`);

    // Verify no NULL org_id rows remain (comments whose tasks also have no org_id
    // would be orphaned — log a warning but do not fail the migration).
    const { rows: orphans } = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM   comments
      WHERE  org_id IS NULL
    `);

    const remaining: number = orphans[0]?.count ?? 0;
    if (remaining > 0) {
      console.warn(
        `WARNING: ${remaining} comment(s) still have org_id = NULL ` +
          `(their parent tasks have no org_id). ` +
          `These rows will use task-join scoping until Phase 3 is applied.`,
      );
    } else {
      console.log(
        "All comment rows now have org_id set. ✓ " +
          "Ready for Phase 3 (add NOT NULL constraint).",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
