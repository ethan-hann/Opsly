/**
 * ReplitStorageProvider — StorageProvider backed by Replit/GCS object storage.
 *
 * Uses the Replit sidecar for authentication (no service-account key needed).
 * The target bucket is read from DEFAULT_OBJECT_STORAGE_BUCKET_ID.
 * All keys are prefixed with STORAGE_PREFIX (default "exports/").
 */

import { Storage } from "@google-cloud/storage";
import type { StorageProvider } from "./provider";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function getClient(): Storage {
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: "json",
          subject_token_field_name: "access_token",
        },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
}

function getBucketName(): string {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) {
    throw new Error(
      "STORAGE_DRIVER=replit requires DEFAULT_OBJECT_STORAGE_BUCKET_ID to be set. " +
        "Provision a bucket via the Replit Object Storage tool.",
    );
  }
  return id;
}

const PREFIX = process.env.STORAGE_PREFIX ?? "exports/";

export class ReplitStorageProvider implements StorageProvider {
  private client = getClient();

  private file(key: string) {
    const bucket = this.client.bucket(getBucketName());
    return bucket.file(`${PREFIX}${key}`);
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const file = this.file(key);
    await file.save(buffer, { contentType, resumable: false });
  }

  async get(key: string): Promise<Buffer | null> {
    const file = this.file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return contents;
  }

  async delete(key: string): Promise<void> {
    const file = this.file(key);
    const [exists] = await file.exists();
    if (exists) await file.delete();
  }

  async exists(key: string): Promise<boolean> {
    const file = this.file(key);
    const [exists] = await file.exists();
    return exists;
  }

  async list(): Promise<string[]> {
    const bucket = this.client.bucket(getBucketName());
    const [files] = await bucket.getFiles({ prefix: PREFIX });
    // Strip the storage-level PREFIX so returned keys match the DB objectKey format.
    return files.map((f) => f.name.slice(PREFIX.length)).filter(Boolean);
  }
}
