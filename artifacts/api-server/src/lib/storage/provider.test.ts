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
 *   - No mock needed for local.ts — it uses Node's built-in fs module.
 *
 * Covered:
 *  - STORAGE_DRIVER=local (explicit) → LocalStorageProvider
 *  - STORAGE_DRIVER unset            → LocalStorageProvider (default)
 *  - STORAGE_DRIVER=LOCAL (casing)   → LocalStorageProvider (case-insensitive)
 *  - STORAGE_DRIVER=s3               → S3StorageProvider
 *  - STORAGE_DRIVER=unknown          → LocalStorageProvider (unrecognised → default)
 *  - Repeated calls return the same cached instance (singleton)
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
  _resetStorageProviderForTesting,
} from "./provider.js";
import { LocalStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";

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
  ]) {
    delete process.env[k];
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear the singleton so each test exercises the factory from a clean state.
  _resetStorageProviderForTesting();
  delete process.env.STORAGE_DRIVER;
  clearS3Env();
});

afterEach(() => {
  delete process.env.STORAGE_DRIVER;
  clearS3Env();
});

// ---------------------------------------------------------------------------
// Tests
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
