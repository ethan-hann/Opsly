/**
 * StorageProvider — pluggable object-storage abstraction.
 *
 * Two concrete implementations are provided:
 *  - ReplitStorageProvider  (STORAGE_DRIVER=replit, default on Replit)
 *  - S3StorageProvider      (STORAGE_DRIVER=s3, any S3-compatible endpoint)
 *
 * The active implementation is chosen by the STORAGE_DRIVER environment
 * variable at server startup.  A descriptive error is thrown at boot time if
 * required environment variables are missing, rather than failing silently at
 * first use.
 */

import { logger } from "../logger";

// ── Interface ─────────────────────────────────────────────────────────────────

export interface StorageProvider {
  /** Write a buffer to the given key. */
  put(key: string, buffer: Buffer, contentType: string): Promise<void>;

  /** Read a key.  Returns null if the object does not exist. */
  get(key: string): Promise<Buffer | null>;

  /** Delete a key (no-op if the object does not exist). */
  delete(key: string): Promise<void>;

  /** Return true if the key exists in storage. */
  exists(key: string): Promise<boolean>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _provider: StorageProvider | undefined;

/**
 * Return the active StorageProvider singleton.
 * Instantiates on first call; subsequent calls return the cached instance.
 * Throws a descriptive Error at boot time if required config is absent.
 */
export function getStorageProvider(): StorageProvider {
  if (_provider) return _provider;

  const driver = (process.env.STORAGE_DRIVER ?? "replit").toLowerCase().trim();

  if (driver === "s3") {
    // Lazy import to avoid bundling the SDK when it is not needed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3StorageProvider } = require("./s3") as typeof import("./s3");
    _provider = new S3StorageProvider();
    logger.info({ driver: "s3" }, "Storage driver: s3-compatible");
  } else {
    // Default to the Replit/GCS implementation.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ReplitStorageProvider } = require("./replit") as typeof import("./replit");
    _provider = new ReplitStorageProvider();
    logger.info({ driver: "replit" }, "Storage driver: replit (GCS)");
  }

  return _provider;
}
