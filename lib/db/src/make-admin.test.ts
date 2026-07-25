/**
 * Integration test: make-admin idempotency behaviour.
 *
 * Runs the CLI script multiple times against a real database and asserts that:
 *   - Granting admin twice: second run exits 0 and logs "already an instance admin, skipping"
 *     and leaves is_instance_admin = true.
 *   - Revoking admin twice: second run exits 0 and logs "already not an instance admin, skipping"
 *     and leaves is_instance_admin = false.
 *
 * The suite is skipped automatically when DATABASE_URL is not set.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const describeIf = process.env.DATABASE_URL ? describe : describe.skip;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "make-admin.ts");

// Unique test email so this test doesn't collide with real users.
const TEST_EMAIL = `make-admin-test-${Date.now()}@integration.local`;

/** Run make-admin.ts via tsx with optional --revoke flag. */
function runScript(revoke = false): { status: number | null; stdout: string; stderr: string } {
  const args = revoke ? [TEST_EMAIL, "--revoke"] : [TEST_EMAIL];
  const result = spawnSync(
    "pnpm",
    ["dlx", "tsx", scriptPath, ...args],
    {
      env: { ...process.env },
      encoding: "utf8",
      // Allow plenty of time for the DB connection + cold tsx start.
      timeout: 30_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describeIf("make-admin — idempotency guard", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  /** Read is_instance_admin directly from the DB for TEST_EMAIL. */
  async function fetchIsAdmin(): Promise<boolean | null> {
    const { rows } = await pool.query<{ is_instance_admin: boolean }>(
      `SELECT is_instance_admin FROM users WHERE email = $1`,
      [TEST_EMAIL],
    );
    return rows[0]?.is_instance_admin ?? null;
  }

  beforeAll(async () => {
    // Insert a test user with is_instance_admin = false so we have a known starting state.
    // Clean up any leftover row from a previous failed run first.
    await pool.query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]);
    await pool.query(
      `INSERT INTO users (email, is_instance_admin, created_at, updated_at)
       VALUES ($1, false, NOW(), NOW())`,
      [TEST_EMAIL],
    );
  });

  afterAll(async () => {
    // Remove the test user so the DB stays clean.
    await pool.query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]);
    await pool.end();
  });

  it("grants admin on the first run", () => {
    const { status, stdout, stderr } = runScript(false);
    expect(status, `Script failed — stderr: ${stderr}`).toBe(0);
    expect(stdout).toContain("Granted instance-admin to");
    expect(stdout).toContain(TEST_EMAIL);
  });

  it("exits 0 and logs 'already an instance admin, skipping' on a second grant", async () => {
    // Verify is_instance_admin is true after first grant.
    const isAdminBefore = await fetchIsAdmin();
    expect(isAdminBefore, "Expected is_instance_admin = true after first grant").toBe(true);

    // Second grant — should skip.
    const { status, stdout, stderr } = runScript(false);

    expect(status, `Script exited non-zero — stderr: ${stderr}`).toBe(0);
    expect(stdout.toLowerCase()).toContain("skipping");
    expect(stdout).toContain("already an instance admin");

    // Flag must still be true.
    const isAdminAfter = await fetchIsAdmin();
    expect(isAdminAfter).toBe(true);
  });

  it("revokes admin on the first revoke run", () => {
    const { status, stdout, stderr } = runScript(true);
    expect(status, `Script failed — stderr: ${stderr}`).toBe(0);
    expect(stdout).toContain("Revoked instance-admin from");
    expect(stdout).toContain(TEST_EMAIL);
  });

  it("exits 0 and logs 'already not an instance admin, skipping' on a second revoke", async () => {
    // Verify is_instance_admin is false after first revoke.
    const isAdminBefore = await fetchIsAdmin();
    expect(isAdminBefore, "Expected is_instance_admin = false after first revoke").toBe(false);

    // Second revoke — should skip.
    const { status, stdout, stderr } = runScript(true);

    expect(status, `Script exited non-zero — stderr: ${stderr}`).toBe(0);
    expect(stdout.toLowerCase()).toContain("skipping");
    expect(stdout).toContain("already not an instance admin");

    // Flag must still be false.
    const isAdminAfter = await fetchIsAdmin();
    expect(isAdminAfter).toBe(false);
  });
});
