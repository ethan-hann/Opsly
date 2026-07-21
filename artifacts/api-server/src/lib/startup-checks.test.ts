/**
 * Integration tests for warnIfNoAdminConfigured (lib/startup-checks.ts).
 *
 * The function is the sole operator guard that notifies when no instance-admin
 * is configured. These tests spin it against a mocked DB (same pattern as the
 * rest of the api-server test suite) and assert logger.warn behaviour under
 * each relevant condition.
 *
 * Covered:
 *  - logger.warn is called when INSTANCE_ADMIN_TOKEN is absent and no
 *    isInstanceAdmin=true user row exists in the DB   (the warning case)
 *  - logger.warn is NOT called when INSTANCE_ADMIN_TOKEN is set            (token suppresses)
 *  - logger.warn is NOT called when an admin user row exists in the DB      (user suppresses)
 *  - logger.warn is called (different overload) when the DB query throws    (error path)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be initialised before any vi.mock() call
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  /** Rows returned by the DB select query. */
  userRows: [] as { isInstanceAdmin: boolean }[],
  /** When true the DB select rejects with an error. */
  dbShouldThrow: false,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db — only the select chain used by warnIfNoAdminConfigured
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (mockState.dbShouldThrow) {
              return Promise.reject(new Error("DB connection failed"));
            }
            return Promise.resolve(mockState.userRows);
          },
        }),
      }),
    }),
  },
  usersTable: { isInstanceAdmin: "isInstanceAdmin" },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock ./logger — we want to spy on warn calls
// ---------------------------------------------------------------------------
vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are registered
// ---------------------------------------------------------------------------
import { warnIfNoAdminConfigured } from "./startup-checks.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resetState() {
  mockState.userRows = [];
  mockState.dbShouldThrow = false;
  vi.mocked(logger.warn).mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("warnIfNoAdminConfigured", () => {
  beforeEach(resetState);

  afterEach(() => {
    delete process.env.INSTANCE_ADMIN_TOKEN;
  });

  // ── Warning case ──────────────────────────────────────────────────────────

  it("calls logger.warn when no INSTANCE_ADMIN_TOKEN is set and no admin user exists", async () => {
    // No token in env, no admin row in DB → warning must fire.
    delete process.env.INSTANCE_ADMIN_TOKEN;
    mockState.userRows = [];

    await warnIfNoAdminConfigured();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledOnce();
    // First positional arg should be the descriptive warning string.
    const [msg] = vi.mocked(logger.warn).mock.calls[0] as [string];
    expect(msg).toMatch(/No instance administrator is configured/);
    expect(msg).toMatch(/INSTANCE_ADMIN_TOKEN/);
  });

  // ── Token suppression ─────────────────────────────────────────────────────

  it("does NOT call logger.warn when INSTANCE_ADMIN_TOKEN is set", async () => {
    process.env.INSTANCE_ADMIN_TOKEN = "some-static-token";
    mockState.userRows = []; // DB wouldn't even be queried

    await warnIfNoAdminConfigured();

    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  // ── Admin user suppression ────────────────────────────────────────────────

  it("does NOT call logger.warn when an isInstanceAdmin=true user exists in the DB", async () => {
    delete process.env.INSTANCE_ADMIN_TOKEN;
    mockState.userRows = [{ isInstanceAdmin: true }];

    await warnIfNoAdminConfigured();

    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  // ── DB error path ─────────────────────────────────────────────────────────

  it("calls logger.warn with the error when the DB query throws", async () => {
    delete process.env.INSTANCE_ADMIN_TOKEN;
    mockState.dbShouldThrow = true;

    await warnIfNoAdminConfigured();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledOnce();
    // Error path uses the two-argument pino overload: logger.warn({ err }, message)
    const [ctx, msg] = vi.mocked(logger.warn).mock.calls[0] as [
      { err: unknown },
      string,
    ];
    expect(ctx).toHaveProperty("err");
    expect(msg).toMatch(/Could not verify instance-admin configuration/);
  });
});
