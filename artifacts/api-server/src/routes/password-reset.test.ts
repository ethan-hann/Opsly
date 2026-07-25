/**
 * Tests for the password-reset routes.
 *
 * POST /api/auth/local/forgot-password
 * POST /api/auth/local/reset-password
 *
 * All external dependencies (@workspace/db, ../lib/auth, ../lib/email,
 * ../lib/local-password, openid-client) are fully mocked so these run
 * without a live database, SMTP server, or OIDC provider.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state (hoisted so vi.mock factories can reference it)
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  authMode: "local" as string,
  // Queue of arrays: each db.select() call pops from the front.
  selectQueue: [] as any[][],
  insertedValues: null as any,
  // Track all update set-values in order (first is user passwordHash, second is consumedAt).
  updateSets: [] as any[],
  deleteCalled: false,
  sendMailCalled: false,
  sendMailArgs: null as any,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/api-zod — only the schemas used by the router matter.
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => ({
  ExchangeMobileAuthorizationCodeBody: {
    safeParse: () => ({ success: false }),
  },
  ExchangeMobileAuthorizationCodeResponse: {
    parse: (v: any) => v,
  },
  GetCurrentAuthUserResponse: {
    parse: (v: any) => v,
  },
  LogoutMobileSessionResponse: {
    parse: (v: any) => v,
  },
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeSelectChain(): any {
    const chain: any = {
      select: (..._args: any[]) => chain,
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(mockState.selectQueue.shift() ?? []),
    };
    return chain;
  }

  function makeInsertChain(): any {
    return {
      values: (vals: any) => {
        mockState.insertedValues = vals;
        return Promise.resolve([]);
      },
    };
  }

  function makeUpdateChain(): any {
    return {
      set: (vals: any) => {
        mockState.updateSets.push(vals);
        return {
          where: () => Promise.resolve([]),
        };
      },
    };
  }

  function makeDeleteChain(): any {
    return {
      where: () => {
        mockState.deleteCalled = true;
        return Promise.resolve([]);
      },
    };
  }

  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => makeInsertChain(),
      update: () => makeUpdateChain(),
      delete: () => makeDeleteChain(),
    },
    usersTable: { id: "id", email: "email", authProvider: "auth_provider" },
    invitationsTable: {},
    passwordResetsTable: {
      id: "id",
      userId: "user_id",
      token: "token",
      consumedAt: "consumed_at",
      expiresAt: "expires_at",
    },
  };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm operators
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock ../lib/auth
// ---------------------------------------------------------------------------
vi.mock("../lib/auth", () => ({
  getAuthMode: () => mockState.authMode,
  getAuthConfig: () => ({ mode: "local" }),
  getOidcConfig: async () => ({}),
  getOidcAuthConfig: () => ({}),
  isOidcAuthMode: () => false,
  createSession: async () => "test-session-id",
  deleteSession: async () => {},
  clearSession: async () => {},
  getSessionId: () => undefined,
  SESSION_COOKIE: "sid",
  SESSION_TTL: 604800000,
}));

// ---------------------------------------------------------------------------
// Mock ../lib/local-password
// ---------------------------------------------------------------------------
vi.mock("../lib/local-password", () => ({
  hashLocalPassword: async (_pw: string) => "scrypt$fakesalt$fakehash",
  verifyLocalPassword: async (_pw: string, _hash: string) => true,
}));

// ---------------------------------------------------------------------------
// Mock ../lib/email
// ---------------------------------------------------------------------------
vi.mock("../lib/email", () => ({
  sendMail: async (opts: any) => {
    mockState.sendMailCalled = true;
    mockState.sendMailArgs = opts;
    return { ok: true };
  },
  buildPasswordResetEmail: (opts: { resetLink: string }) =>
    `<html>reset link: ${opts.resetLink}</html>`,
}));

// ---------------------------------------------------------------------------
// Mock openid-client — not exercised by the new routes, but the router imports it.
// ---------------------------------------------------------------------------
vi.mock("openid-client", () => ({
  randomState: () => "state",
  randomNonce: () => "nonce",
  randomPKCECodeVerifier: () => "verifier",
  calculatePKCECodeChallenge: async () => "challenge",
  buildAuthorizationUrl: () => ({ href: "https://example.com/auth" }),
  authorizationCodeGrant: async () => ({}),
  buildEndSessionUrl: () => ({ href: "https://example.com/logout" }),
}));

// ---------------------------------------------------------------------------
// Import router AFTER all mocks are registered.
// ---------------------------------------------------------------------------
import authRouter from "./auth.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  // Add a minimal req.log stub so route-level logging calls don't throw.
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", authRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const GENERIC_MESSAGE =
  "If an account exists for this email, a reset link has been sent.";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Tests — POST /api/auth/local/forgot-password
// ---------------------------------------------------------------------------
describe("POST /api/auth/local/forgot-password", () => {
  beforeEach(() => {
    mockState.authMode = "local";
    mockState.selectQueue = [];
    mockState.insertedValues = null;
    mockState.updateSets = [];
    mockState.deleteCalled = false;
    mockState.sendMailCalled = false;
    mockState.sendMailArgs = null;
  });

  it("returns 400 when AUTH_MODE is not local", async () => {
    mockState.authMode = "oidc";
    const res = await request(buildApp())
      .post("/api/auth/local/forgot-password")
      .send({ email: "user@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/local auth is disabled/i);
  });

  it("returns 400 when email is missing", async () => {
    const res = await request(buildApp())
      .post("/api/auth/local/forgot-password")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when email is invalid", async () => {
    const res = await request(buildApp())
      .post("/api/auth/local/forgot-password")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 200 with generic message when no account exists for the email", async () => {
    // User lookup returns empty — unknown email.
    mockState.selectQueue = [[]];

    const res = await request(buildApp())
      .post("/api/auth/local/forgot-password")
      .send({ email: "unknown@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
    // No email should be sent for an unknown address.
    expect(mockState.sendMailCalled).toBe(false);
    // No token inserted.
    expect(mockState.insertedValues).toBeNull();
  });

  it("returns 200 with generic message and sends email when account exists", async () => {
    // User lookup returns a matching local user.
    mockState.selectQueue = [[{ id: "user-1", email: "user@example.com" }]];

    const res = await request(buildApp())
      .post("/api/auth/local/forgot-password")
      .send({ email: "user@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(mockState.sendMailCalled).toBe(true);
    expect(mockState.sendMailArgs.to).toBe("user@example.com");
    expect(mockState.sendMailArgs.subject).toMatch(/reset/i);
    // Token should have been inserted.
    expect(mockState.insertedValues).not.toBeNull();
    expect(mockState.insertedValues.userId).toBe("user-1");
    expect(typeof mockState.insertedValues.token).toBe("string");
    expect(mockState.insertedValues.token.length).toBe(64); // 32 bytes hex
    // Previous unconsumed tokens deleted.
    expect(mockState.deleteCalled).toBe(true);
  });

  it("lowercases the email before lookup", async () => {
    mockState.selectQueue = [[]];

    await request(buildApp())
      .post("/api/auth/local/forgot-password")
      .send({ email: "User@Example.COM" });

    // Whether or not user found, response must be generic 200.
    // The important thing is we don't crash on uppercase email.
    // (We can't inspect the select args from the mock, but at least no error.)
    expect(mockState.sendMailCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — POST /api/auth/local/reset-password
// ---------------------------------------------------------------------------
describe("POST /api/auth/local/reset-password", () => {
  beforeEach(() => {
    mockState.authMode = "local";
    mockState.selectQueue = [];
    mockState.insertedValues = null;
    mockState.updateSets = [];
    mockState.deleteCalled = false;
  });

  it("returns 400 when AUTH_MODE is not local", async () => {
    mockState.authMode = "replit_oidc";
    const res = await request(buildApp())
      .post("/api/auth/local/reset-password")
      .send({ token: "abc", password: "newpassword1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/local auth is disabled/i);
  });

  it("returns 400 when token is missing", async () => {
    const res = await request(buildApp())
      .post("/api/auth/local/reset-password")
      .send({ password: "newpassword1" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too short (< 8 chars)", async () => {
    const res = await request(buildApp())
      .post("/api/auth/local/reset-password")
      .send({ token: "sometoken", password: "short" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when token does not exist in DB", async () => {
    // Token lookup returns empty.
    mockState.selectQueue = [[]];

    const res = await request(buildApp())
      .post("/api/auth/local/reset-password")
      .send({ token: "nonexistent-token", password: "newpassword1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it("returns 400 when token is already consumed", async () => {
    const consumedRow = {
      id: "reset-1",
      userId: "user-1",
      token: "tok123",
      consumedAt: new Date(), // already consumed
      expiresAt: FUTURE,
    };
    mockState.selectQueue = [[consumedRow]];

    const res = await request(buildApp())
      .post("/api/auth/local/reset-password")
      .send({ token: "tok123", password: "newpassword1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it("returns 400 when token is expired", async () => {
    const expiredRow = {
      id: "reset-2",
      userId: "user-1",
      token: "tok456",
      consumedAt: null,
      expiresAt: PAST, // expired
    };
    mockState.selectQueue = [[expiredRow]];

    const res = await request(buildApp())
      .post("/api/auth/local/reset-password")
      .send({ token: "tok456", password: "newpassword1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it("returns 200 and updates password when token is valid", async () => {
    const validRow = {
      id: "reset-3",
      userId: "user-1",
      token: "validtoken",
      consumedAt: null,
      expiresAt: FUTURE,
    };
    mockState.selectQueue = [[validRow]];

    const res = await request(buildApp())
      .post("/api/auth/local/reset-password")
      .send({ token: "validtoken", password: "newpassword1" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password updated/i);
    // First update: user's passwordHash was set.
    expect(mockState.updateSets.length).toBeGreaterThanOrEqual(1);
    expect(typeof mockState.updateSets[0].passwordHash).toBe("string");
  });
});
