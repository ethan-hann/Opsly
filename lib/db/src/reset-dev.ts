/**
 * Dev database reset script.
 *
 * Wipes all application data and leaves the database completely empty.
 *
 * Default workflow stages, roles, and other org data are seeded automatically
 * when a user creates an org through the app — nothing is pre-seeded here.
 *
 * Usage:
 *   pnpm --filter @workspace/db run reset-dev
 *   pnpm --filter @workspace/db run reset-dev --yes   # skip confirmation
 *
 * ⚠️  DESTRUCTIVE — only run against a local dev database.
 */

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

async function main(): Promise<void> {
  console.log(
    "\x1b[33m⚠️  WARNING\x1b[0m  This will permanently delete ALL application data and log out all users.\n",
  );

  const args = process.argv.slice(2);
  const autoConfirm =
    args.includes("--yes") ||
    args.includes("-y") ||
    process.env.NO_PROMPT === "true";

  if (!autoConfirm) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) =>
      rl.question('Type "yes" to continue: ', resolve),
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Clear sessions so all users are logged out after reset.
    await client.query(`DELETE FROM sessions`);

    // Deleting all organizations cascades to every FK-referencing table:
    // roles, org_members, invitations, projects, tasks, comments,
    // comment_reactions, notes, inbound_webhooks, outbound_webhooks,
    // outbound_webhook_deliveries, custom_field_definitions, task_templates,
    // saved_views, sla_policies, workflow_stages, notifications,
    // notification_preferences, email_digest_preferences, org_terminology,
    // org_events, org_features, api_keys, task_events, task_watchers,
    // task_dependencies, project_sla_policy_audit.
    await client.query(`DELETE FROM organizations`);

    // Tables not FK'd to organizations.
    await client.query(`DELETE FROM export_jobs`);
    await client.query(`DELETE FROM instance_smtp_config`);

    await client.query("COMMIT");

    console.log("\x1b[32m✓ Database reset — completely empty.\x1b[0m");
    console.log("  All users have been logged out.");
    console.log("  Sign in and create an org to get started.");
    console.log(
      "  Default workflow stages are seeded automatically on org creation.\n",
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\x1b[31m✗ Reset failed — rolled back.\x1b[0m", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
