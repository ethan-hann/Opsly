/**
 * StorageProvider — pluggable object-storage abstraction.
 *
 * Two concrete implementations are provided:
 *  - LocalStorageProvider   (STORAGE_DRIVER=local, default when unset — writes to ./data/exports/)
 *  - S3StorageProvider      (STORAGE_DRIVER=s3 — any S3-compatible endpoint)
 *
 * The active implementation is chosen by the STORAGE_DRIVER environment
 * variable at server startup.
 *
 * Call initStorageProvider() once during server startup (index.ts) to
 * validate configuration eagerly.  If required variables are absent it logs
 * a FATAL message and exits with code 1 so container orchestrators surface
 * the failure immediately — before any traffic reaches the server.
 */

import { logger } from "../logger";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";

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

  /**
   * List all object keys stored by this provider.
   * Returns keys in the same format used by put/get/delete (i.e. without any
   * internal storage prefix), so the result can be compared directly against
   * the objectKey column in exportJobsTable.
   */
  list(): Promise<string[]>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _provider: StorageProvider | undefined;

/**
 * Reset the cached provider singleton.
 *
 * Intended for use in unit tests only (clear the singleton between cases that
 * each set a different STORAGE_DRIVER).  Not called in production code.
 */
export function _resetStorageProviderForTesting(): void {
  _provider = undefined;
}

/**
 * Return the active StorageProvider singleton.
 * Instantiates on first call; subsequent calls return the cached instance.
 * Prefer calling initStorageProvider() at startup over calling this directly.
 */
export function getStorageProvider(): StorageProvider {
  if (_provider) return _provider;

  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase().trim();

  if (driver === "s3") {
    _provider = new S3StorageProvider();
  } else {
    // Default: local filesystem — writes to LOCAL_STORAGE_PATH (default ./data/exports/).
    _provider = new LocalStorageProvider();
  }

  return _provider;
}

// ── Startup validation ────────────────────────────────────────────────────────

/** Show a variable as "set" or "missing" — never log its actual value. */
function varStatus(name: string): { name: string; status: "set" | "missing" } {
  return { name, status: process.env[name] ? "set" : "missing" };
}

/**
 * Validate storage configuration eagerly at server startup.
 *
 * - Checks all required environment variables for the configured driver.
 * - Logs a FATAL-level message with each var listed as "set" or "missing"
 *   (actual values are NEVER logged — credentials stay out of log files).
 * - Exits with code 1 if config is incomplete so the container orchestrator
 *   surfaces the misconfiguration immediately.
 * - On success logs a single INFO line with the active driver and safe
 *   non-secret details (bucket name, region, endpoint, prefix).
 *
 * Call once from index.ts before app.listen().
 */
export function initStorageProvider(): void {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase().trim();
  // In development, missing storage config is non-fatal — export operations
  // will fail at runtime with a clear error, which is acceptable when running
  // without a provisioned storage bucket.  In production, exit immediately so
  // the container orchestrator surfaces the misconfiguration before traffic arrives.
  const isProd = process.env.NODE_ENV === "production";

  if (driver === "s3") {
    const required = (
      ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const
    ).map(varStatus);
    const missing = required.filter((v) => v.status === "missing");

    if (missing.length > 0) {
      const ctx = {
        driver: "s3",
        required,
        optional: [
          { name: "S3_ENDPOINT",     status: process.env.S3_ENDPOINT     ? "set" : "not set", note: "omit for AWS S3; set for MinIO, Cloudflare R2, Backblaze B2, etc." },
          { name: "STORAGE_PREFIX",  status: process.env.STORAGE_PREFIX  ? "set" : "not set", note: "default: exports/" },
        ],
        fixGuide:
          "Set the missing variables and restart:\n" +
          "  S3_BUCKET            — bucket name\n" +
          "  S3_REGION            — e.g. us-east-1\n" +
          "  S3_ACCESS_KEY_ID     — IAM access key ID\n" +
          "  S3_SECRET_ACCESS_KEY — IAM secret access key\n" +
          "  S3_ENDPOINT          — (optional) custom endpoint URL\n" +
          "  STORAGE_PREFIX       — (optional) object key prefix, default: exports/\n" +
          "See docs/SELF_HOSTING.md for the full setup guide.",
      };
      const msg = `Storage misconfigured: STORAGE_DRIVER=s3 requires ${missing.map((v) => v.name).join(", ")}`;
      if (isProd) { logger.fatal(ctx, msg); process.exit(1); }
      else         { logger.warn(ctx, msg + " — export features disabled in this dev environment"); return; }
    }

    try {
      getStorageProvider();
      logger.info(
        {
          driver: "s3",
          bucket:   process.env.S3_BUCKET,
          region:   process.env.S3_REGION,
          endpoint: process.env.S3_ENDPOINT ?? "(AWS default)",
          prefix:   process.env.STORAGE_PREFIX ?? "exports/",
        },
        "Storage driver ready",
      );
    } catch (err) {
      logger.fatal({ err, driver: "s3" }, "Storage driver failed to initialize");
      process.exit(1);
    }
  } else {
    // local driver (default) — writes to LOCAL_STORAGE_PATH (default: ./data/exports/).
    // No required env vars; always succeeds.
    try {
      getStorageProvider();
      logger.info(
        {
          driver: "local",
          path: process.env.LOCAL_STORAGE_PATH ?? "./data/exports",
          prefix: process.env.STORAGE_PREFIX ?? "exports/",
        },
        "Storage driver ready",
      );
    } catch (err) {
      logger.fatal({ err, driver: "local" }, "Storage driver failed to initialize");
      process.exit(1);
    }
  }
}