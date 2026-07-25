/**
 * LocalStorageProvider — StorageProvider backed by the local filesystem.
 *
 * Intended for local development and Docker dev stacks.  Not suitable for
 * production (no redundancy, no signed URLs, single-node only).
 *
 * Environment variables:
 *   LOCAL_STORAGE_PATH — base directory for stored files (default: ./data/exports/)
 *   STORAGE_PREFIX     — sub-directory prefix within LOCAL_STORAGE_PATH
 *                        (default: "exports/"; kept for API parity with other drivers)
 */

import fs from "fs/promises";
import path from "path";
import type { StorageProvider } from "./provider";

/**
 * Recursively walk `dir` and return all file paths relative to `rootDir`,
 * normalised to forward-slashes (matches DB objectKey format).
 * Uses only the Node.js built-in `fs.readdir` with `withFileTypes` but
 * without the `recursive` flag so it works with all supported Node typings.
 */
async function walkDir(dir: string, rootDir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await walkDir(fullPath, rootDir);
      results.push(...children);
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, fullPath);
      results.push(rel.split(path.sep).join("/"));
    }
  }
  return results;
}

function getBaseDir(): string {
  return path.resolve(process.env.LOCAL_STORAGE_PATH ?? "./data/exports");
}

const PREFIX = process.env.STORAGE_PREFIX ?? "exports/";

export class LocalStorageProvider implements StorageProvider {
  /** Resolve a logical key to an absolute filesystem path. */
  private filePath(key: string): string {
    // Sanitize to prevent path traversal: strip leading slashes, resolve
    // against the base dir, and verify the result stays inside it.
    const relative = path.normalize(path.join(PREFIX, key)).replace(/^(\.\.[/\\])+/, "");
    const full = path.join(getBaseDir(), relative);
    const base = path.resolve(getBaseDir());
    if (!full.startsWith(base + path.sep) && full !== base) {
      throw new Error(`Path traversal detected for key: ${key}`);
    }
    return full;
  }

  private async ensureDir(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  async put(key: string, buffer: Buffer, _contentType: string): Promise<void> {
    const fp = this.filePath(key);
    await this.ensureDir(fp);
    await fs.writeFile(fp, buffer);
  }

  async get(key: string): Promise<Buffer | null> {
    const fp = this.filePath(key);
    try {
      return await fs.readFile(fp);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const fp = this.filePath(key);
    try {
      await fs.unlink(fp);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const fp = this.filePath(key);
    try {
      await fs.access(fp);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    const dir = path.join(getBaseDir(), PREFIX);
    try {
      return await walkDir(dir, dir);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw err;
    }
  }
}
