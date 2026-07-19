import { db } from "../index";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_templates (
      id SERIAL PRIMARY KEY,
      org_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      default_title TEXT NOT NULL DEFAULT '',
      default_priority VARCHAR(16) NOT NULL DEFAULT 'medium',
      default_category VARCHAR(32) NOT NULL DEFAULT 'other',
      default_description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("task_templates table created (or already exists)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
