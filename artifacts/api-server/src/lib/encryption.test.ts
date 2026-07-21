/**
 * Unit tests for lib/encryption.ts — AES-256-GCM encrypt/decrypt.
 *
 * Covered:
 *  - decrypt(encrypt(x)) === x  (roundtrip fidelity)
 *  - ciphertext is not equal to plaintext  (encryption actually happened)
 *  - ciphertext format is <iv>:<authTag>:<data> (three colon-separated parts)
 *  - two encryptions of the same plaintext produce different ciphertexts (IV randomness)
 *  - decrypt throws on a tampered ciphertext (auth-tag verification)
 *  - encrypt/decrypt throw when SECRET_ENCRYPTION_KEY is missing
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Set a deterministic test key before the module is imported.
// The key must be set BEFORE import so getEncryptionKey() sees it.
const TEST_KEY = "vitest-smtp-security-test-key-32b";

beforeAll(() => {
  process.env["SECRET_ENCRYPTION_KEY"] = TEST_KEY;
});

afterAll(() => {
  delete process.env["SECRET_ENCRYPTION_KEY"];
});

import { encrypt, decrypt } from "./encryption.js";

describe("encrypt / decrypt", () => {
  it("roundtrips: decrypt(encrypt(x)) === x", () => {
    const plain = "super-secret-smtp-password!";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("roundtrips with an empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("roundtrips with unicode characters", () => {
    const plain = "pässwörd-🔐-日本語";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("ciphertext is not equal to the plaintext", () => {
    const plain = "my-password";
    const cipher = encrypt(plain);
    expect(cipher).not.toBe(plain);
    expect(cipher).not.toContain("my-password");
  });

  it("ciphertext has the three-part <iv>:<authTag>:<data> format", () => {
    const cipher = encrypt("test");
    const parts = cipher.split(":");
    expect(parts).toHaveLength(3);
    // IV is 12 bytes → 24 hex chars
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/);
    // Auth tag is 16 bytes → 32 hex chars
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    // Data is base64
    expect(parts[2]).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV)", () => {
    const plain = "same-password";
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  it("throws on a tampered ciphertext (auth-tag failure)", () => {
    const cipher = encrypt("original");
    // Flip the last byte of the data segment
    const parts = cipher.split(":");
    const tampered = parts[2]!.slice(0, -2) + "AA";
    expect(() => decrypt(`${parts[0]}:${parts[1]}:${tampered}`)).toThrow();
  });

  it("throws when ciphertext has wrong number of segments", () => {
    expect(() => decrypt("onlyone")).toThrow(/Invalid ciphertext format/);
    expect(() => decrypt("a:b")).toThrow(/Invalid ciphertext format/);
  });
});

describe("encrypt / decrypt — missing key", () => {
  it("throws when SECRET_ENCRYPTION_KEY is not set", () => {
    const saved = process.env["SECRET_ENCRYPTION_KEY"];
    delete process.env["SECRET_ENCRYPTION_KEY"];
    try {
      expect(() => encrypt("x")).toThrow(/SECRET_ENCRYPTION_KEY/);
    } finally {
      process.env["SECRET_ENCRYPTION_KEY"] = saved;
    }
  });
});
