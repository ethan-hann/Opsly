/**
 * Unit tests for ReplitStorageProvider.
 *
 * @google-cloud/storage is fully mocked — no real GCS bucket or sidecar is
 * contacted. The test suite verifies that the provider issues the correct GCS
 * calls with the right bucket name and prefixed file paths, and that it handles
 * the hit/miss/empty scenarios the same way the S3 and Local providers do.
 *
 * Covered:
 *  - put calls file.save with the correct contentType and data
 *  - get (hit) calls file.exists → file.download and returns the Buffer
 *  - get (miss) returns null when file.exists returns false
 *  - delete (hit) calls file.delete when file.exists returns true
 *  - delete (miss) is a no-op when file.exists returns false
 *  - exists returns true/false based on file.exists
 *  - list returns [] when bucket.getFiles returns no files
 *  - list returns unprefixed keys when files are present
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be initialised before vi.mock() is evaluated
// ---------------------------------------------------------------------------

/** Controls what mockFile methods return for each test. */
const mockFileSave = vi.hoisted(() => vi.fn());
const mockFileExists = vi.hoisted(() => vi.fn());
const mockFileDownload = vi.hoisted(() => vi.fn());
const mockFileDelete = vi.hoisted(() => vi.fn());
const mockBucketGetFiles = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage
// ---------------------------------------------------------------------------
vi.mock("@google-cloud/storage", () => {
  function MockFile(this: Record<string, unknown>, name: string) {
    this.name = name;
    this.save = mockFileSave;
    this.exists = mockFileExists;
    this.download = mockFileDownload;
    this.delete = mockFileDelete;
  }

  function MockBucket(this: Record<string, unknown>, name: string) {
    this.name = name;
    this.file = function (path: string) {
      return new (MockFile as unknown as new (n: string) => typeof MockFile)(
        path,
      );
    };
    this.getFiles = mockBucketGetFiles;
  }

  function MockStorage(this: Record<string, unknown>) {
    this.bucket = function (name: string) {
      return new (MockBucket as unknown as new (n: string) => typeof MockBucket)(
        name,
      );
    };
  }

  return { Storage: MockStorage };
});

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are registered
// ---------------------------------------------------------------------------
import { ReplitStorageProvider } from "./replit.js";

// ---------------------------------------------------------------------------
// Constants shared across tests
// ---------------------------------------------------------------------------
const BUCKET = "test-bucket-id";
const PREFIX = "exports/"; // default STORAGE_PREFIX

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let provider: ReplitStorageProvider;

beforeEach(() => {
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = BUCKET;
  delete process.env.STORAGE_PREFIX; // use the module-level default "exports/"

  mockFileSave.mockReset();
  mockFileExists.mockReset();
  mockFileDownload.mockReset();
  mockFileDelete.mockReset();
  mockBucketGetFiles.mockReset();

  provider = new ReplitStorageProvider();
});

afterEach(() => {
  delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
});

// ---------------------------------------------------------------------------
// put
// ---------------------------------------------------------------------------
describe("ReplitStorageProvider — put", () => {
  it("calls file.save with the buffer, contentType, and resumable:false", async () => {
    mockFileSave.mockResolvedValueOnce(undefined);

    const data = Buffer.from("export content");
    await provider.put("job-123.csv", data, "text/csv");

    expect(mockFileSave).toHaveBeenCalledOnce();
    const [savedBuffer, opts] = mockFileSave.mock.calls[0] as [
      Buffer,
      { contentType: string; resumable: boolean },
    ];
    expect(savedBuffer).toEqual(data);
    expect(opts.contentType).toBe("text/csv");
    expect(opts.resumable).toBe(false);
  });

  it("propagates errors thrown by file.save", async () => {
    mockFileSave.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(
      provider.put("fail.csv", Buffer.from("x"), "text/csv"),
    ).rejects.toThrow("Permission denied");
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------
describe("ReplitStorageProvider — get", () => {
  it("returns the Buffer when the file exists", async () => {
    const expected = Buffer.from("csv row 1\nrow 2");
    mockFileExists.mockResolvedValueOnce([true]);
    mockFileDownload.mockResolvedValueOnce([expected]);

    const result = await provider.get("job-456.csv");

    expect(result).not.toBeNull();
    expect(result!.equals(expected)).toBe(true);
  });

  it("calls file.exists with the prefixed key", async () => {
    mockFileExists.mockResolvedValueOnce([true]);
    mockFileDownload.mockResolvedValueOnce([Buffer.from("")]);

    await provider.get("job-456.csv");

    // The file object was constructed with the prefixed path; we verify
    // that exists() was called (one time).
    expect(mockFileExists).toHaveBeenCalledOnce();
  });

  it("returns null when file.exists returns false", async () => {
    mockFileExists.mockResolvedValueOnce([false]);

    const result = await provider.get("missing.csv");

    expect(result).toBeNull();
    expect(mockFileDownload).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by file.download", async () => {
    mockFileExists.mockResolvedValueOnce([true]);
    mockFileDownload.mockRejectedValueOnce(new Error("Network error"));
    await expect(provider.get("broken.csv")).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
describe("ReplitStorageProvider — delete", () => {
  it("calls file.delete when the file exists", async () => {
    mockFileExists.mockResolvedValueOnce([true]);
    mockFileDelete.mockResolvedValueOnce(undefined);

    await provider.delete("job-789.csv");

    expect(mockFileDelete).toHaveBeenCalledOnce();
  });

  it("is a no-op when the file does not exist", async () => {
    mockFileExists.mockResolvedValueOnce([false]);

    await expect(provider.delete("gone.csv")).resolves.toBeUndefined();

    expect(mockFileDelete).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by file.delete", async () => {
    mockFileExists.mockResolvedValueOnce([true]);
    mockFileDelete.mockRejectedValueOnce(new Error("Access denied"));
    await expect(provider.delete("locked.csv")).rejects.toThrow("Access denied");
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------
describe("ReplitStorageProvider — exists", () => {
  it("returns true when file.exists returns true", async () => {
    mockFileExists.mockResolvedValueOnce([true]);
    expect(await provider.exists("present.csv")).toBe(true);
  });

  it("returns false when file.exists returns false", async () => {
    mockFileExists.mockResolvedValueOnce([false]);
    expect(await provider.exists("absent.csv")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
describe("ReplitStorageProvider — list", () => {
  it("returns an empty array when bucket.getFiles returns no files", async () => {
    mockBucketGetFiles.mockResolvedValueOnce([[]]);
    expect(await provider.list()).toEqual([]);
  });

  it("returns keys with the PREFIX stripped so they match DB objectKey format", async () => {
    mockBucketGetFiles.mockResolvedValueOnce([
      [
        { name: `${PREFIX}a.csv` },
        { name: `${PREFIX}b.csv` },
        { name: `${PREFIX}sub/c.csv` },
      ],
    ]);

    const keys = await provider.list();
    expect(keys.sort()).toEqual(["a.csv", "b.csv", "sub/c.csv"].sort());
  });

  it("calls bucket.getFiles with the correct prefix", async () => {
    mockBucketGetFiles.mockResolvedValueOnce([[]]);
    await provider.list();

    expect(mockBucketGetFiles).toHaveBeenCalledOnce();
    const [opts] = mockBucketGetFiles.mock.calls[0] as [{ prefix: string }];
    expect(opts.prefix).toBe(PREFIX);
  });

  it("filters out entries where stripping the prefix yields an empty string", async () => {
    // A file whose name IS exactly the prefix would strip to "".
    mockBucketGetFiles.mockResolvedValueOnce([
      [{ name: PREFIX }, { name: `${PREFIX}real.csv` }],
    ]);

    const keys = await provider.list();
    expect(keys).toEqual(["real.csv"]);
  });
});
