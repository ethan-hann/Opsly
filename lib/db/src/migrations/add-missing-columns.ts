import { db } from "../index";
import { sql } from "drizzle-orm";

async function main() {
  // Add sla_breached_at to tasks if missing
  await db.execute(sql`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ
  `);
  console.log("sla_breached_at column ensured");

  // Add org_id to comments if missing (NOT NULL, with a backfill from the task)
  // First add nullable, backfill, then not-null — but only if column is absent
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'comments' AND column_name = 'org_id'
  `);
  if (result.rows.length === 0) {
    await db.execute(sql`ALTER TABLE comments ADD COLUMN org_id VARCHAR`);
    await db.execute(sql`
      UPDATE comments c
      SET org_id = t.org_id
      FROM tasks t
      WHERE c.task_id = t.id AND c.org_id IS NULL
    `);
    console.log("comments.org_id backfilled");
  } else {
    console.log("comments.org_id already exists");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
