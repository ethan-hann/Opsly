/**
 * Tests confirming the server fails fast with a clear message when
 * SECRET_ENCRYPTION_KEY is absent and an encrypted SMTP password exists.
 *
 * Covered:
 *  - loadSmtpOverride() calls process.exit(1) when the DB row has
 *    passEncrypted but SECRET_ENCRYPTION_KEY is unset
 *  - loadSmtpOverride() completes normally when the DB row has no password
 *    even if SECRET_ENCRYPTION_KEY is unset (no key, no encrypted data — fine)
 *  - applySmtpOverride() throws a descriptive error (not a raw crypto throw)
 *    when SECRET_ENCRYPTION_KEY is unset and a password is supplied
 *  - applySmtpOverride() succeeds when no password is supplied even if
 *    SECRET_ENCRYPTION_KEY is unset
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Keep track of DB inserts so we can verify applySmtpOverride reached the DB
// ---------------------------------------------------------------------------
const insertValuesSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const selectResultHoisted = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(rows: any[]): any {
    const c: any = {
      from: () => c,
      where: () => c,
      limit: () => Promise.resolve(rows),
      then(f: any, r: any) { return Promise.resolve(rows).then(f, r); },
    };
    return c;
  }

  return {
    db: {
      select: () => makeChain(selectResultHoisted.rows),
      insert: () => ({
        values: insertValuesSpy,
      }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    },
    instanceSmtpConfigTable: { id: "id" },
    eq: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Import the module under test AFTER mocks are in place
import { loadSmtpOverride, applySmtpOverride } from "./email.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withoutEncryptionKey(fn: () => Promise<void> | void) {
  const saved = process.env["SECRET_ENCRYPTION_KEY"];
  delete process.env["SECRET_ENCRYPTION_KEY"];
  try {
    await fn();
  } finally {
    // Restore AFTER fn fully resolves so async checks inside fn see the
    // deleted key throughout their entire execution (not just during the
    // synchronous preamble before the first await).
    if (saved !== undefined) process.env["SECRET_ENCRYPTION_KEY"] = saved;
  }
}

// ---------------------------------------------------------------------------
// loadSmtpOverride — missing key with encrypted password
// ---------------------------------------------------------------------------

describe("loadSmtpOverride() — SECRET_ENCRYPTION_KEY absent", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Prevent process.exit from actually killing the test process
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    (logger.fatal as ReturnType<typeof vi.fn>).mockClear();
    (logger.error as ReturnType<typeof vi.fn>).mockClear();
    selectResultHoisted.rows = [];
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("calls process.exit(1) when DB row has passEncrypted and key is missing", async () => {
    selectResultHoisted.rows = [{
      id: "default",
      host: "smtp.example.com",
      port: "587",
      secure: false,
      user: "user",
      passEncrypted: "aabbcc:ddeeff:base64data==",
      fromAddress: "Opsly <noreply@example.com>",
    }];

    // The outer try/catch in loadSmtpOverride swallows errors, so the
    // promise resolves — we verify the side-effects instead.
    await withoutEncryptionKey(async () => {
      await loadSmtpOverride();
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.fatal as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    const msg = (logger.fatal as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(msg).toContain("SECRET_ENCRYPTION_KEY");
  });

  it("does NOT call process.exit when DB row has no passEncrypted (key absent is fine)", async () => {
    selectResultHoisted.rows = [{
      id: "default",
      host: "smtp.example.com",
      port: "587",
      secure: false,
      user: "user",
      passEncrypted: null,
      fromAddress: "Opsly <noreply@example.com>",
    }];

    await withoutEncryptionKey(async () => {
      await expect(loadSmtpOverride()).resolves.not.toThrow();
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does NOT call process.exit when no DB row exists at all", async () => {
    selectResultHoisted.rows = [];

    await withoutEncryptionKey(async () => {
      await expect(loadSmtpOverride()).resolves.not.toThrow();
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// applySmtpOverride — missing key with a password
// ---------------------------------------------------------------------------

describe("applySmtpOverride() — SECRET_ENCRYPTION_KEY absent", () => {
  beforeEach(() => {
    insertValuesSpy.mockClear();
  });

  it("throws a descriptive error when a password is supplied but key is missing", async () => {
    await withoutEncryptionKey(async () => {
      await expect(
        applySmtpOverride({
          host: "smtp.example.com",
          port: 587,
          secure: false,
          user: "user",
          pass: "secret-pass",
          from: "Opsly <noreply@example.com>",
        }),
      ).rejects.toThrow(/SECRET_ENCRYPTION_KEY/);
    });

    // DB insert must NOT be reached — no partial write
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("error message is human-readable (not a raw crypto error)", async () => {
    let thrown: Error | undefined;
    await withoutEncryptionKey(async () => {
      try {
        await applySmtpOverride({
          host: "smtp.example.com",
          port: 587,
          secure: false,
          user: "user",
          pass: "secret-pass",
          from: "Opsly <noreply@example.com>",
        });
      } catch (err) {
        thrown = err as Error;
      }
    });

    expect(thrown).toBeDefined();
    // Should be our descriptive message, not Node crypto's internal error
    expect(thrown!.message).toContain("SECRET_ENCRYPTION_KEY");
    expect(thrown!.message).toContain("encrypt");
  });

  it("succeeds when no password is supplied even if key is missing", async () => {
    // Arrange: mock insert chain to support onConflictDoUpdate
    insertValuesSpy.mockReturnValueOnce({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });

    await withoutEncryptionKey(async () => {
      await expect(
        applySmtpOverride({
          host: "smtp.example.com",
          port: 587,
          secure: false,
          user: "",
          // pass deliberately omitted — no encryption needed
          from: "Opsly <noreply@example.com>",
        }),
      ).resolves.not.toThrow();
    });
  });
});
