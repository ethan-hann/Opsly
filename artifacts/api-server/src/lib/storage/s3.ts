/**
 * S3StorageProvider — StorageProvider backed by any S3-compatible object store.
 *
 * Works with AWS S3, MinIO, Cloudflare R2, Backblaze B2, etc.
 *
 * Required environment variables (when STORAGE_DRIVER=s3):
 *   S3_BUCKET            — bucket name
 *   S3_REGION            — region (e.g. "us-east-1")
 *   S3_ACCESS_KEY_ID     — access key ID
 *   S3_SECRET_ACCESS_KEY — secret access key
 *
 * Optional:
 *   S3_ENDPOINT      — custom endpoint URL (omit for AWS S3)
 *   STORAGE_PREFIX   — key prefix applied to every object (default "exports/").
 *                      Must match the prefix used by LocalStorageProvider so the two drivers are interchangeable.  All keys passed to
 *                      put/get/delete/exists are stored under this prefix; list()
 *                      strips the prefix from returned keys so callers always
 *                      work with unprefixed objectKeys (same format as the DB).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { StorageProvider } from "./provider";

// Must match the default used in local.ts so drivers are interchangeable.
const PREFIX = process.env.STORAGE_PREFIX ?? "exports/";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `STORAGE_DRIVER=s3 requires ${name} to be set. ` +
        "Check your environment variables.",
    );
  }
  return value;
}

function buildClient(): S3Client {
  const region = requireEnv("S3_REGION");
  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");
  requireEnv("S3_BUCKET"); // validate early

  const endpoint = process.env.S3_ENDPOINT;

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    // Validate + build at construction time so config errors surface at boot.
    this.client = buildClient();
    this.bucket = requireEnv("S3_BUCKET");
  }

  /** Prepend the storage prefix so the S3 key is isolated from other bucket objects. */
  private fullKey(key: string): string {
    return `${PREFIX}${key}`;
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(key),
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length,
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      );
      if (!response.Body) return null;
      // response.Body is a Readable in Node; collect into a Buffer.
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === "NoSuchKey" || code === "NotFound") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      );
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === "NoSuchKey" || code === "NotFound") return;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all export-managed object keys in the bucket.
   *
   * Only objects under PREFIX are enumerated (foreign bucket objects are
   * never visible).  The PREFIX is stripped from each returned key so the
   * result matches the DB objectKey format, exactly as LocalStorageProvider does.  Handles S3 pagination transparently.
   */
  async list(): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: PREFIX,  // scope to export-managed objects only
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      for (const obj of response.Contents ?? []) {
        if (obj.Key) {
          // Strip PREFIX so the key matches the DB objectKey column.
          keys.push(obj.Key.slice(PREFIX.length));
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }
}
