/**
 * Integration test: create-local-user skip-on-existing behaviour.
 *
 * Runs the CLI script twice against a real database and asserts that the
 * second invocation:
 *   - exits with code 0 (no error)
 *   - logs "already exists, skipping" to stdout
 *   - leaves the stored password_hash completely unchanged
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
const scriptPath = path.resolve(__dirname, "create-local-user.ts");

// Unique test email so this test doesn't collide with real users.
const TEST_EMAIL = `create-local-user-test-${Date.now()}@integration.local`;
const TEST_PASSWORD = "hunter2";
const TEST_FIRST = "Test";
const TEST_LAST = "Skip";

/** Run create-local-user.ts via tsx with the given arguments. */
function runScript(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    "pnpm",
    ["dlx", "tsx", scriptPath, TEST_EMAIL, ...args],
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

describeIf("create-local-user — skip when user already exists", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  /** Read password_hash directly from the DB for TEST_EMAIL. */
  async function fetchPasswordHash(): Promise<string | null> {
    const { rows } = await pool.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE email = $1`,
      [TEST_EMAIL],
    );
    return rows[0]?.password_hash ?? null;
  }

  beforeAll(async () => {
    // Clean up any leftover row from a previous failed run.
    await pool.query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]);
  });

  afterAll(async () => {
    // Remove the test user so the DB stays clean.
    await pool.query(`DELETE FROM users WHERE email = $1`, [TEST_EMAIL]);
    await pool.end();
  });

  it("creates the user on the first run", () => {
    const { status, stdout, stderr } = runScript(TEST_PASSWORD, TEST_FIRST, TEST_LAST);
    expect(status, `Script failed — stderr: ${stderr}`).toBe(0);
    expect(stdout).toContain("Local user created");
    expect(stdout).toContain(TEST_EMAIL);
  });

  it("exits 0 and logs 'already exists, skipping' on the second run", async () => {
    // Capture the hash that was stored after the first run.
    const hashBefore = await fetchPasswordHash();
    expect(hashBefore, "Expected a password_hash row after first run").toBeTruthy();

    // Second invocation — same arguments.
    const { status, stdout, stderr } = runScript(TEST_PASSWORD, TEST_FIRST, TEST_LAST);

    expect(status, `Script exited non-zero — stderr: ${stderr}`).toBe(0);
    expect(stdout.toLowerCase()).toContain("skipping");

    // The stored hash must be byte-for-byte identical.
    const hashAfter = await fetchPasswordHash();
    expect(hashAfter).toBe(hashBefore);
  });

  it("does not overwrite a changed password when re-run", async () => {
    // Simulate: admin manually updated the password in the DB.
    const manualHash = "scrypt$deadbeef$cafebabe";
    await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = $2`,
      [manualHash, TEST_EMAIL],
    );

    // Re-running setup with a different password must NOT overwrite it.
    const { status, stderr } = runScript("different-password", TEST_FIRST, TEST_LAST);
    expect(status, `Script exited non-zero — stderr: ${stderr}`).toBe(0);

    const hashAfter = await fetchPasswordHash();
    expect(hashAfter).toBe(manualHash);
  });
});
