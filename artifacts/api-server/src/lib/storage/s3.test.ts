/**
 * Unit tests for S3StorageProvider.
 *
 * @aws-sdk/client-s3 is fully mocked — no real S3 bucket or network call is
 * made.  The test suite verifies that the provider issues the correct S3
 * commands with the right Bucket + Key arguments and that it handles the
 * relevant S3 error codes (NoSuchKey / NotFound) by returning the expected
 * null / false / void values.
 *
 * Covered:
 *  - put issues PutObjectCommand with correct Bucket, Key (prefixed), Body, and ContentType
 *  - get (hit) issues GetObjectCommand and returns the assembled Buffer
 *  - get (miss) returns null when S3 throws NoSuchKey
 *  - delete issues DeleteObjectCommand; silently ignores NoSuchKey
 *  - exists returns true when HeadObjectCommand succeeds
 *  - exists returns false when HeadObjectCommand throws
 *  - list returns unprefixed keys; handles pagination via ContinuationToken
 *  - list returns [] when Contents is empty / undefined
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be initialised before vi.mock() is evaluated
// ---------------------------------------------------------------------------
const mockSend = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-s3
// Use regular function constructors (not arrow functions) so `new` works.
// ---------------------------------------------------------------------------
vi.mock("@aws-sdk/client-s3", () => {
  // S3Client: a real constructor whose instances expose the shared mockSend spy.
  function MockS3Client(this: { send: typeof mockSend }) {
    this.send = mockSend;
  }

  function MockCommand(
    this: Record<string, unknown>,
    type: string,
    args: unknown,
  ) {
    Object.assign(this, args as object);
    this._type = type;
  }

  return {
    S3Client: MockS3Client,
    PutObjectCommand: function (this: Record<string, unknown>, args: unknown) {
      MockCommand.call(this, "PutObjectCommand", args);
    },
    GetObjectCommand: function (this: Record<string, unknown>, args: unknown) {
      MockCommand.call(this, "GetObjectCommand", args);
    },
    DeleteObjectCommand: function (
      this: Record<string, unknown>,
      args: unknown,
    ) {
      MockCommand.call(this, "DeleteObjectCommand", args);
    },
    HeadObjectCommand: function (this: Record<string, unknown>, args: unknown) {
      MockCommand.call(this, "HeadObjectCommand", args);
    },
    ListObjectsV2Command: function (
      this: Record<string, unknown>,
      args: unknown,
    ) {
      MockCommand.call(this, "ListObjectsV2Command", args);
    },
  };
});

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are registered
// ---------------------------------------------------------------------------
import { S3StorageProvider } from "./s3.js";

// We don't import the command classes — we inspect what was passed to
// mockSend instead of inspecting constructor call records.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an AsyncIterable<Uint8Array> that yields a single chunk. */
async function* makeBody(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

/** S3 error stub with a `name` field (how the SDK surfaces error codes). */
function s3Error(name: string): Error {
  const err = new Error(`S3 error: ${name}`);
  (err as Error & { name: string }).name = name;
  return err;
}

const BUCKET = "test-bucket";
const PREFIX = "exports/"; // default STORAGE_PREFIX

// ---------------------------------------------------------------------------
// Setup — provide required env vars before each test
// ---------------------------------------------------------------------------
let provider: S3StorageProvider;

beforeEach(() => {
  process.env.S3_BUCKET = BUCKET;
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "test-key-id";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  delete process.env.STORAGE_PREFIX; // use default "exports/"

  mockSend.mockReset();
  provider = new S3StorageProvider();
});

afterEach(() => {
  delete process.env.S3_BUCKET;
  delete process.env.S3_REGION;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S3StorageProvider — put", () => {
  it("issues PutObjectCommand with the correct Bucket, prefixed Key, Body, and ContentType", async () => {
    mockSend.mockResolvedValueOnce({});

    const data = Buffer.from("export content");
    await provider.put("job-123.csv", data, "text/csv");

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0]![0] as {
      Bucket: string;
      Key: string;
      Body: Buffer;
      ContentType: string;
      ContentLength: number;
    };
    expect(cmd.Bucket).toBe(BUCKET);
    expect(cmd.Key).toBe(`${PREFIX}job-123.csv`);
    expect(cmd.Body).toEqual(data);
    expect(cmd.ContentType).toBe("text/csv");
    expect(cmd.ContentLength).toBe(data.length);
  });

  it("propagates unexpected errors from S3", async () => {
    mockSend.mockRejectedValueOnce(new Error("Access Denied"));
    await expect(
      provider.put("fail.csv", Buffer.from("x"), "text/csv"),
    ).rejects.toThrow("Access Denied");
  });
});

describe("S3StorageProvider — get", () => {
  it("returns the assembled Buffer when the object exists", async () => {
    const expected = Buffer.from("csv data row 1\nrow 2");
    mockSend.mockResolvedValueOnce({ Body: makeBody(expected) });

    const result = await provider.get("job-456.csv");

    expect(result).not.toBeNull();
    expect(result!.equals(expected)).toBe(true);

    // Inspect the command instance passed to client.send().
    const cmd = mockSend.mock.calls[0]![0] as { Bucket: string; Key: string };
    expect(cmd.Bucket).toBe(BUCKET);
    expect(cmd.Key).toBe(`${PREFIX}job-456.csv`);
  });

  it("returns null when S3 throws NoSuchKey", async () => {
    mockSend.mockRejectedValueOnce(s3Error("NoSuchKey"));
    expect(await provider.get("missing.csv")).toBeNull();
  });

  it("returns null when S3 throws NotFound", async () => {
    mockSend.mockRejectedValueOnce(s3Error("NotFound"));
    expect(await provider.get("also-missing.csv")).toBeNull();
  });

  it("returns null when Body is falsy", async () => {
    mockSend.mockResolvedValueOnce({ Body: null });
    expect(await provider.get("empty-body.csv")).toBeNull();
  });

  it("propagates unexpected S3 errors", async () => {
    mockSend.mockRejectedValueOnce(s3Error("InternalError"));
    await expect(provider.get("broken.csv")).rejects.toThrow("InternalError");
  });
});

describe("S3StorageProvider — delete", () => {
  it("issues DeleteObjectCommand with the correct Bucket and prefixed Key", async () => {
    mockSend.mockResolvedValueOnce({});

    await provider.delete("job-789.csv");

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0]![0] as { Bucket: string; Key: string };
    expect(cmd.Bucket).toBe(BUCKET);
    expect(cmd.Key).toBe(`${PREFIX}job-789.csv`);
  });

  it("is a no-op (does not throw) when S3 returns NoSuchKey", async () => {
    mockSend.mockRejectedValueOnce(s3Error("NoSuchKey"));
    await expect(provider.delete("gone.csv")).resolves.toBeUndefined();
  });

  it("is a no-op (does not throw) when S3 returns NotFound", async () => {
    mockSend.mockRejectedValueOnce(s3Error("NotFound"));
    await expect(provider.delete("also-gone.csv")).resolves.toBeUndefined();
  });

  it("propagates unexpected S3 errors", async () => {
    mockSend.mockRejectedValueOnce(s3Error("AccessDenied"));
    await expect(provider.delete("locked.csv")).rejects.toThrow("AccessDenied");
  });
});

describe("S3StorageProvider — exists", () => {
  it("returns true when HeadObjectCommand succeeds", async () => {
    mockSend.mockResolvedValueOnce({});
    expect(await provider.exists("present.csv")).toBe(true);

    const cmd = mockSend.mock.calls[0]![0] as { Bucket: string; Key: string };
    expect(cmd.Bucket).toBe(BUCKET);
    expect(cmd.Key).toBe(`${PREFIX}present.csv`);
  });

  it("returns false when HeadObjectCommand throws (any error)", async () => {
    mockSend.mockRejectedValueOnce(s3Error("NoSuchKey"));
    expect(await provider.exists("absent.csv")).toBe(false);
  });

  it("returns false when HeadObjectCommand throws a generic error", async () => {
    mockSend.mockRejectedValueOnce(new Error("Not Found"));
    expect(await provider.exists("unreachable.csv")).toBe(false);
  });
});

describe("S3StorageProvider — list", () => {
  it("returns an empty array when S3 returns no Contents", async () => {
    mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });
    expect(await provider.list()).toEqual([]);
  });

  it("returns an empty array when Contents is undefined", async () => {
    mockSend.mockResolvedValueOnce({ IsTruncated: false });
    expect(await provider.list()).toEqual([]);
  });

  it("returns keys with the PREFIX stripped so they match DB objectKey format", async () => {
    mockSend.mockResolvedValueOnce({
      Contents: [
        { Key: `${PREFIX}a.csv` },
        { Key: `${PREFIX}b.csv` },
        { Key: `${PREFIX}sub/c.csv` },
      ],
      IsTruncated: false,
    });

    const keys = await provider.list();
    expect(keys.sort()).toEqual(["a.csv", "b.csv", "sub/c.csv"].sort());
  });

  it("sends ListObjectsV2Command with the correct Bucket and Prefix", async () => {
    mockSend.mockResolvedValueOnce({ IsTruncated: false });
    await provider.list();

    const cmd = mockSend.mock.calls[0]![0] as { Bucket: string; Prefix: string };
    expect(cmd.Bucket).toBe(BUCKET);
    expect(cmd.Prefix).toBe(PREFIX);
  });

  it("handles pagination: follows ContinuationToken until IsTruncated is false", async () => {
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: `${PREFIX}page1.csv` }],
        IsTruncated: true,
        NextContinuationToken: "token-abc",
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: `${PREFIX}page2.csv` }],
        IsTruncated: false,
      });

    const keys = await provider.list();
    expect(keys.sort()).toEqual(["page1.csv", "page2.csv"].sort());

    // Second call must carry the ContinuationToken from the first response.
    const secondCmd = mockSend.mock.calls[1]![0] as { ContinuationToken: string };
    expect(secondCmd.ContinuationToken).toBe("token-abc");
  });

  it("skips entries where Key is undefined", async () => {
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: `${PREFIX}real.csv` }, {}],
      IsTruncated: false,
    });

    const keys = await provider.list();
    expect(keys).toEqual(["real.csv"]);
  });
});
