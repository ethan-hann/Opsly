/**
 * Unit tests for the StorageProvider factory (provider.ts).
 *
 * getStorageProvider() maintains a module-level singleton.  We reset it
 * between tests with _resetStorageProviderForTesting() so each test can
 * exercise a different STORAGE_DRIVER branch independently.
 *
 * We use the REAL driver modules (local.ts, s3.ts) rather than mocking them.
 * Their external dependencies are mocked instead:
 *   - @aws-sdk/client-s3 is mocked so S3StorageProvider can be instantiated
 *     without real credentials or a running S3 endpoint.
 *   - @google-cloud/storage is mocked so ReplitStorageProvider can be
 *     instantiated without a running Replit sidecar.
 *   - No mock needed for local.ts — it uses Node's built-in fs module.
 *
 * Covered — getStorageProvider():
 *  - STORAGE_DRIVER=local (explicit) → LocalStorageProvider
 *  - STORAGE_DRIVER unset            → LocalStorageProvider (default)
 *  - STORAGE_DRIVER=LOCAL (casing)   → LocalStorageProvider (case-insensitive)
 *  - STORAGE_DRIVER=s3               → S3StorageProvider
 *  - STORAGE_DRIVER=unknown          → LocalStorageProvider (unrecognised → default)
 *  - Repeated calls return the same cached instance (singleton)
 *
 * Covered — initStorageProvider():
 *  - STORAGE_DRIVER=s3, all vars present → logs INFO, no process.exit
 *  - STORAGE_DRIVER=s3, missing vars, NODE_ENV=production → logs FATAL, calls process.exit(1)
 *  - STORAGE_DRIVER=s3, missing vars, NODE_ENV=development → logs WARN, no process.exit
 *  - STORAGE_DRIVER=local (default) → always succeeds, logs INFO
 *  - STORAGE_DRIVER=replit, var present → logs INFO, no process.exit
 *  - STORAGE_DRIVER=replit, missing var, NODE_ENV=production → logs FATAL, calls process.exit(1)
 *  - STORAGE_DRIVER=replit, missing var, NODE_ENV=development → logs WARN, no process.exit
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-s3 so S3StorageProvider can be constructed without
// real credentials.  vi.mock is hoisted before any import statement.
// ---------------------------------------------------------------------------
vi.mock("@aws-sdk/client-s3", () => {
  function MockS3Client(this: { send: ReturnType<typeof vi.fn> }) {
    this.send = vi.fn();
  }
  const makeCmd = () =>
    function MockCommand(this: Record<string, unknown>, args: unknown) {
      Object.assign(this, args as object);
    };
  return {
    S3Client: MockS3Client,
    PutObjectCommand: makeCmd(),
    GetObjectCommand: makeCmd(),
    DeleteObjectCommand: makeCmd(),
    HeadObjectCommand: makeCmd(),
    ListObjectsV2Command: makeCmd(),
  };
});

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage so ReplitStorageProvider can be constructed
// without a running Replit sidecar.
// ---------------------------------------------------------------------------
vi.mock("@google-cloud/storage", () => {
  function MockStorage(this: object) {}
  MockStorage.prototype.bucket = vi.fn(() => ({
    file: vi.fn(() => ({})),
    getFiles: vi.fn(async () => [[]]),
  }));
  return { Storage: MockStorage };
});

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import module under test + driver classes for instanceof assertions.
// ---------------------------------------------------------------------------
import {
  getStorageProvider,
  initStorageProvider,
  _resetStorageProviderForTesting,
} from "./provider.js";
import { LocalStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setS3Env() {
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "key-id";
  process.env.S3_SECRET_ACCESS_KEY = "secret";
}

function clearS3Env() {
  for (const k of [
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_ENDPOINT",
  ]) {
    delete process.env[k];
  }
}

function clearReplitEnv() {
  delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear the singleton so each test exercises the factory from a clean state.
  _resetStorageProviderForTesting();
  delete process.env.STORAGE_DRIVER;
  delete process.env.NODE_ENV;
  clearS3Env();
  clearReplitEnv();
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.fatal).mockClear();
});

afterEach(() => {
  delete process.env.STORAGE_DRIVER;
  delete process.env.NODE_ENV;
  clearS3Env();
  clearReplitEnv();
});

// ---------------------------------------------------------------------------
// Tests — getStorageProvider factory
// ---------------------------------------------------------------------------

describe("getStorageProvider factory", () => {
  it("returns LocalStorageProvider when STORAGE_DRIVER is unset (default)", () => {
    delete process.env.STORAGE_DRIVER;
    expect(getStorageProvider()).toBeInstanceOf(LocalStorageProvider);
  });

  it('returns LocalStorageProvider when STORAGE_DRIVER="local"', () => {
    process.env.STORAGE_DRIVER = "local";
    expect(getStorageProvider()).toBeInstanceOf(LocalStorageProvider);
  });

  it("is case-insensitive: STORAGE_DRIVER=LOCAL returns LocalStorageProvider", () => {
    process.env.STORAGE_DRIVER = "LOCAL";
    expect(getStorageProvider()).toBeInstanceOf(LocalStorageProvider);
  });

  it('returns S3StorageProvider when STORAGE_DRIVER="s3"', () => {
    process.env.STORAGE_DRIVER = "s3";
    setS3Env();
    expect(getStorageProvider()).toBeInstanceOf(S3StorageProvider);
  });

  it("is case-insensitive: STORAGE_DRIVER=S3 returns S3StorageProvider", () => {
    process.env.STORAGE_DRIVER = "S3";
    setS3Env();
    expect(getStorageProvider()).toBeInstanceOf(S3StorageProvider);
  });

  it("falls back to LocalStorageProvider for an unrecognised STORAGE_DRIVER value", () => {
    process.env.STORAGE_DRIVER = "unknown-driver";
    expect(getStorageProvider()).toBeInstanceOf(LocalStorageProvider);
  });

  it("returns the same cached instance on repeated calls (singleton)", () => {
    const first = getStorageProvider();
    const second = getStorageProvider();
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Tests — initStorageProvider startup validation
// ---------------------------------------------------------------------------

describe("initStorageProvider", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Intercept process.exit and throw so the function stops exactly as it
    // would in production.  Tests that expect an exit must catch the throw.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as () => never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  // ── STORAGE_DRIVER=s3 ─────────────────────────────────────────────────────

  describe("STORAGE_DRIVER=s3", () => {
    beforeEach(() => {
      process.env.STORAGE_DRIVER = "s3";
    });

    it("logs INFO and does NOT call process.exit when all required vars are present", () => {
      setS3Env();
      initStorageProvider();

      expect(vi.mocked(logger.info)).toHaveBeenCalledOnce();
      const [ctx, msg] = vi.mocked(logger.info).mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(ctx).toMatchObject({ driver: "s3" });
      expect(msg).toMatch(/Storage driver ready/);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("logs FATAL and calls process.exit(1) when vars are missing in production", () => {
      // No S3 env vars set — all four are missing.
      process.env.NODE_ENV = "production";

      // exitSpy throws so execution truly stops after process.exit(1).
      expect(() => initStorageProvider()).toThrow("process.exit(1)");

      expect(vi.mocked(logger.fatal)).toHaveBeenCalledOnce();
      const [ctx, msg] = vi.mocked(logger.fatal).mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(ctx).toMatchObject({ driver: "s3" });
      expect(msg).toMatch(/Storage misconfigured/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("logs WARN and does NOT call process.exit when vars are missing in development", () => {
      // No S3 env vars set; non-production NODE_ENV.
      process.env.NODE_ENV = "development";

      initStorageProvider();

      expect(vi.mocked(logger.warn)).toHaveBeenCalledOnce();
      const [, msg] = vi.mocked(logger.warn).mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(msg).toMatch(/Storage misconfigured/);
      expect(msg).toMatch(/export features disabled/);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("includes the names of every missing variable in the FATAL log context", () => {
      // Only provide two of the four required vars — the other two must appear
      // in the 'required' list with status 'missing'.
      process.env.NODE_ENV = "production";
      process.env.S3_BUCKET = "my-bucket";
      process.env.S3_REGION = "eu-west-1";
      // S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY intentionally absent.

      // exitSpy throws so execution truly stops after process.exit(1).
      expect(() => initStorageProvider()).toThrow("process.exit(1)");

      const [ctx] = vi.mocked(logger.fatal).mock.calls[0] as [
        { required: { name: string; status: string }[] },
        string,
      ];
      const missing = ctx.required.filter((v) => v.status === "missing");
      expect(missing.map((v) => v.name)).toEqual(
        expect.arrayContaining(["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]),
      );
      const present = ctx.required.filter((v) => v.status === "set");
      expect(present.map((v) => v.name)).toEqual(
        expect.arrayContaining(["S3_BUCKET", "S3_REGION"]),
      );
    });
  });

  // ── STORAGE_DRIVER=local (default) ────────────────────────────────────────

  describe("STORAGE_DRIVER=local (default)", () => {
    it("logs INFO and does NOT call process.exit when STORAGE_DRIVER is unset", () => {
      delete process.env.STORAGE_DRIVER;

      initStorageProvider();

      expect(vi.mocked(logger.info)).toHaveBeenCalledOnce();
      const [ctx, msg] = vi.mocked(logger.info).mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(ctx).toMatchObject({ driver: "local" });
      expect(msg).toMatch(/Storage driver ready/);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("logs INFO and does NOT call process.exit when STORAGE_DRIVER=local (explicit)", () => {
      process.env.STORAGE_DRIVER = "local";

      initStorageProvider();

      expect(vi.mocked(logger.info)).toHaveBeenCalledOnce();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("succeeds even when NODE_ENV=production (local requires no vars)", () => {
      process.env.STORAGE_DRIVER = "local";
      process.env.NODE_ENV = "production";

      initStorageProvider();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(vi.mocked(logger.fatal)).not.toHaveBeenCalled();
    });
  });

  // ── STORAGE_DRIVER=replit ─────────────────────────────────────────────────

  describe("STORAGE_DRIVER=replit", () => {
    beforeEach(() => {
      process.env.STORAGE_DRIVER = "replit";
    });

    it("logs INFO and does NOT call process.exit when DEFAULT_OBJECT_STORAGE_BUCKET_ID is set", () => {
      process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "bucket-abc123";

      initStorageProvider();

      expect(vi.mocked(logger.info)).toHaveBeenCalledOnce();
      const [ctx, msg] = vi.mocked(logger.info).mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(ctx).toMatchObject({ driver: "replit" });
      expect(msg).toMatch(/Storage driver ready/);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("logs FATAL and calls process.exit(1) when DEFAULT_OBJECT_STORAGE_BUCKET_ID is missing in production", () => {
      // DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set.
      process.env.NODE_ENV = "production";

      // exitSpy throws so execution truly stops after process.exit(1).
      expect(() => initStorageProvider()).toThrow("process.exit(1)");

      expect(vi.mocked(logger.fatal)).toHaveBeenCalledOnce();
      const [ctx, msg] = vi.mocked(logger.fatal).mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(ctx).toMatchObject({ driver: "replit" });
      expect(msg).toMatch(/Storage misconfigured/);
      expect(msg).toMatch(/DEFAULT_OBJECT_STORAGE_BUCKET_ID/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("logs WARN and does NOT call process.exit when DEFAULT_OBJECT_STORAGE_BUCKET_ID is missing in development", () => {
      // DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set; non-production environment.
      process.env.NODE_ENV = "development";

      initStorageProvider();

      expect(vi.mocked(logger.warn)).toHaveBeenCalledOnce();
      const [, msg] = vi.mocked(logger.warn).mock.calls[0] as [
        Record<string, unknown>,
        string,
      ];
      expect(msg).toMatch(/Storage misconfigured/);
      expect(msg).toMatch(/export features disabled/);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
