/**
 * Migration: add task_template_id to inbound_webhooks.
 *
 * Purpose
 * -------
 * Lets admins link a saved task template to an inbound webhook so the webhook
 * edit form can auto-fill the TemplateBuilder defaults from the template.  The
 * column stores the template that was used to seed the config at edit time; the
 * baked-in TemplateBuilder values remain intact when the template is later
 * deleted or changed (SET NULL, not CASCADE DELETE of webhook data).
 *
 * Usage
 * -----
 *   DATABASE_URL=... pnpm --filter @workspace/db migrate:add-inbound-webhook-task-template-id
 *
 * Idempotent: safe to re-run.
 */

import pg from "pg";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Add the optional FK column (NULL means no template was used to seed this webhook).
    // ON DELETE SET NULL preserves the TemplateBuilder config even when the template is removed.
    await pool.query(`
      ALTER TABLE inbound_webhooks
        ADD COLUMN IF NOT EXISTS task_template_id INTEGER
          REFERENCES task_templates(id) ON DELETE SET NULL;
    `);
    console.log("Migration complete: task_template_id added to inbound_webhooks.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
