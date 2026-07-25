/**
 * Unit tests for LocalStorageProvider.
 *
 * Covered:
 *  - put / get round-trip
 *  - get returns null for a missing key
 *  - delete removes an existing file
 *  - delete is a no-op for a missing key
 *  - exists returns true/false correctly
 *  - list returns empty array when no files exist
 *  - list returns all stored keys (without internal path prefix)
 *  - path-traversal keys are rejected with an error
 *
 * Each test gets its own tmp directory (mkdtemp) that is deleted on exit.
 * LOCAL_STORAGE_PATH is set to that directory before each test so tests
 * are fully isolated and never touch the real ./data/exports path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// STORAGE_PREFIX must be set before the module is imported (module-level const).
// We choose a value that is clearly ours and clean it up in afterEach.
const TEST_PREFIX = "exports/";
process.env.STORAGE_PREFIX = TEST_PREFIX;

import { LocalStorageProvider } from "./local.js";

describe("LocalStorageProvider", () => {
  let tmpDir: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-storage-test-"));
    // getBaseDir() reads this on every call — changing it between tests is safe.
    process.env.LOCAL_STORAGE_PATH = tmpDir;
    provider = new LocalStorageProvider();
  });

  afterEach(async () => {
    delete process.env.LOCAL_STORAGE_PATH;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── put / get ─────────────────────────────────────────────────────────────

  it("put then get returns the same buffer", async () => {
    const data = Buffer.from("hello storage");
    await provider.put("file.txt", data, "text/plain");
    const result = await provider.get("file.txt");
    expect(result).not.toBeNull();
    expect(result!.equals(data)).toBe(true);
  });

  it("put creates intermediate directories automatically", async () => {
    const data = Buffer.from("nested content");
    await provider.put("org/2024/report.csv", data, "text/csv");
    const result = await provider.get("org/2024/report.csv");
    expect(result).not.toBeNull();
    expect(result!.equals(data)).toBe(true);
  });

  it("put with binary data preserves bytes exactly", async () => {
    const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    await provider.put("binary.bin", data, "application/octet-stream");
    const result = await provider.get("binary.bin");
    expect(result).not.toBeNull();
    expect(result!.equals(data)).toBe(true);
  });

  it("put overwrites an existing key", async () => {
    await provider.put("overwrite.txt", Buffer.from("first"), "text/plain");
    await provider.put("overwrite.txt", Buffer.from("second"), "text/plain");
    const result = await provider.get("overwrite.txt");
    expect(result!.toString()).toBe("second");
  });

  // ── get miss ──────────────────────────────────────────────────────────────

  it("get returns null for a key that does not exist", async () => {
    const result = await provider.get("does-not-exist.txt");
    expect(result).toBeNull();
  });

  // ── delete ────────────────────────────────────────────────────────────────

  it("delete removes an existing file", async () => {
    await provider.put("to-delete.txt", Buffer.from("bye"), "text/plain");
    await provider.delete("to-delete.txt");
    expect(await provider.exists("to-delete.txt")).toBe(false);
  });

  it("delete is a no-op when the key does not exist (does not throw)", async () => {
    await expect(provider.delete("ghost.txt")).resolves.toBeUndefined();
  });

  // ── exists ────────────────────────────────────────────────────────────────

  it("exists returns true for a key that has been put", async () => {
    await provider.put("present.txt", Buffer.from("x"), "text/plain");
    expect(await provider.exists("present.txt")).toBe(true);
  });

  it("exists returns false for a key that has not been put", async () => {
    expect(await provider.exists("absent.txt")).toBe(false);
  });

  it("exists returns false after a key is deleted", async () => {
    await provider.put("temp.txt", Buffer.from("x"), "text/plain");
    await provider.delete("temp.txt");
    expect(await provider.exists("temp.txt")).toBe(false);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it("list returns an empty array when no files have been stored", async () => {
    const keys = await provider.list();
    expect(keys).toEqual([]);
  });

  it("list returns all stored keys without the internal prefix", async () => {
    await provider.put("a.csv", Buffer.from("1"), "text/csv");
    await provider.put("b.csv", Buffer.from("2"), "text/csv");
    await provider.put("sub/c.csv", Buffer.from("3"), "text/csv");

    const keys = await provider.list();
    expect(keys.sort()).toEqual(["a.csv", "b.csv", "sub/c.csv"].sort());
  });

  it("list only returns keys still present (deleted files excluded)", async () => {
    await provider.put("keep.txt", Buffer.from("k"), "text/plain");
    await provider.put("remove.txt", Buffer.from("r"), "text/plain");
    await provider.delete("remove.txt");

    const keys = await provider.list();
    expect(keys).toContain("keep.txt");
    expect(keys).not.toContain("remove.txt");
  });

  // ── path-traversal rejection ──────────────────────────────────────────────
  //
  // The filePath() guard works as follows:
  //   1. path.join(PREFIX, key) is normalised (resolves `..` segments).
  //   2. Leading `../` sequences are stripped by the regex.
  //   3. If the final resolved path still escapes the base directory the
  //      method throws.  This happens when the normalised form after PREFIX
  //      contraction lands at ".." (e.g. key="../.." → join gives ".." once
  //      the single "exports" level is consumed, and ".." is not stripped
  //      because it lacks a trailing slash).

  it("throws on a key that escapes the base directory after prefix contraction", () => {
    // "exports/" + "../.." normalises to ".."; the strip regex leaves ".." as-is
    // (no trailing slash), so path.join(base, "..") resolves to the parent dir.
    expect(() => {
      (provider as unknown as { filePath(k: string): string }).filePath("../..");
    }).toThrow(/Path traversal detected/);
  });

  it("throws on a deeper traversal that still escapes after prefix contraction", () => {
    // "exports/" + "../../.." normalises to "../.."; strip removes leading "../"
    // portion leaving ".."; path.join(base, "..") still escapes.
    expect(() => {
      (provider as unknown as { filePath(k: string): string }).filePath(
        "../../..",
      );
    }).toThrow(/Path traversal detected/);
  });

  it("throws when a safe-looking sub-path contains enough `..` segments to escape", () => {
    // "exports/" + "a/../../.." normalises to ".."; still escapes the base dir.
    expect(() => {
      (provider as unknown as { filePath(k: string): string }).filePath(
        "a/../../..",
      );
    }).toThrow(/Path traversal detected/);
  });
});
