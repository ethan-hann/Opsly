/**
 * Signed unsubscribe tokens for one-click digest email opt-out.
 *
 * Tokens are minimal JWTs signed with HMAC-SHA256 using SESSION_SECRET.
 * Payload: { sub: userId, exp: Unix-seconds }
 * Expiry: 30 days from issuance.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Returns the SESSION_SECRET, throwing if it is absent or empty.
 * Token operations must never fall back to an empty secret — an empty secret
 * allows anyone to forge valid tokens and unsubscribe arbitrary users.
 */
function getSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not configured — unsubscribe token operations are disabled",
    );
  }
  return secret;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

/**
 * Generate a signed 30-day unsubscribe token for the given user.
 * Throws if SESSION_SECRET is not set.
 */
export function generateUnsubscribeToken(userId: string): string {
  const secret = getSecret();
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: userId, exp: Math.floor((Date.now() + TOKEN_TTL_MS) / 1000) }),
  );
  const sig = sign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${sig}`;
}

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string };

/**
 * Verify a token. Returns { ok: true, userId } or { ok: false, reason }.
 * Throws if SESSION_SECRET is not set.
 */
export function verifyUnsubscribeToken(token: string): VerifyResult {
  const secret = getSecret();
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [header, payload, sig] = parts as [string, string, string];
  const expected = sign(`${header}.${payload}`, secret);

  // Timing-safe comparison
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(sig);
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { ok: false, reason: "invalid signature" };
  }

  let parsed: { sub?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed payload" };
  }

  if (typeof parsed.sub !== "string") return { ok: false, reason: "missing sub" };
  if (typeof parsed.exp !== "number") return { ok: false, reason: "missing exp" };
  if (Math.floor(Date.now() / 1000) > parsed.exp) return { ok: false, reason: "expired" };

  return { ok: true, userId: parsed.sub };
}
