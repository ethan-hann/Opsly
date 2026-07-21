/**
 * Encryption utility — AES-256-GCM symmetric encryption via Node's built-in
 * `crypto` module. No third-party dependencies.
 *
 * Usage:
 *   const ciphertext = encrypt("my-secret-password");
 *   const plaintext  = decrypt(ciphertext);
 *
 * The ciphertext is a self-contained base64 string in the format:
 *   <iv_hex>:<authTag_hex>:<ciphertext_base64>
 *
 * The encryption key is read from the SECRET_ENCRYPTION_KEY environment
 * variable. It must be at least 32 bytes (hex-encoded → 64 hex chars, or any
 * string that produces ≥32 bytes of UTF-8). The key is derived to exactly
 * 32 bytes via SHA-256.
 *
 * This module is the single place where credential encryption/decryption lives.
 * All other features that store secrets in the database should import from here.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// ─── Key derivation ───────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const raw = process.env["SECRET_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY environment variable is required for credential " +
        "encryption but was not set. Please set it to a random 32+ byte secret.",
    );
  }
  // Derive a stable 32-byte key from whatever the operator supplies.
  return createHash("sha256").update(raw).digest();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt `plaintext` with AES-256-GCM.
 * Returns a self-contained string "<iv_hex>:<authTag_hex>:<ciphertext_base64>"
 * that can be stored safely in the database.
 *
 * @throws if SECRET_ENCRYPTION_KEY is not set.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a ciphertext produced by `encrypt()`.
 * Returns the original plaintext string.
 *
 * @throws if SECRET_ENCRYPTION_KEY is not set or the ciphertext is malformed /
 *         tampered.
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format — expected <iv>:<authTag>:<data>");
  }
  const [ivHex, authTagHex, dataB64] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
