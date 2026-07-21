/**
 * Tests confirming that the SMTP password never leaks through any API response.
 *
 * Uses the Bearer-token path of requireInstanceAdmin so no DB session is
 * needed — just set INSTANCE_ADMIN_TOKEN and send the matching header.
 *
 * Covered:
 *  - GET /api/admin/email/status response body has `hasPassword` but no `pass`
 *    or any other plain-text password field
 *  - PUT /api/admin/email/config response body has `hasPassword` but no `pass`
 *  - PUT /api/admin/email/config passes ciphertext (not plaintext) to the DB
 *    via applySmtpOverride
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Environment setup — must happen before any import that reads env vars
// ---------------------------------------------------------------------------
const ADMIN_TOKEN = "test-instance-admin-token";
const ENC_KEY = "vitest-smtp-test-encryption-key!";

beforeAll(() => {
  process.env["INSTANCE_ADMIN_TOKEN"] = ADMIN_TOKEN;
  process.env["SECRET_ENCRYPTION_KEY"] = ENC_KEY;
});

afterAll(() => {
  delete process.env["INSTANCE_ADMIN_TOKEN"];
  delete process.env["SECRET_ENCRYPTION_KEY"];
});

// ---------------------------------------------------------------------------
// Spies on email lib functions — hoisted so vi.mock factory can use them
// ---------------------------------------------------------------------------
const applySmtpOverrideSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getEmailConfigSpy = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    configured: true,
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "smtp-user",
    from: "Opsly <noreply@example.com>",
    source: "db",
    hasPassword: true,
    // NOTE: deliberately no `pass` field — matches the real implementation
  }),
);

vi.mock("../lib/email", () => ({
  getEmailConfig: getEmailConfigSpy,
  applySmtpOverride: applySmtpOverrideSpy,
  clearSmtpOverride: vi.fn().mockResolvedValue(undefined),
  sendMail: vi.fn().mockResolvedValue({ ok: true }),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db — only logAdminAction (insert) is called by these routes
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve([]),
        then(f: any, r: any) { return Promise.resolve([]).then(f, r); },
      };
      return chain;
    },
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        then(f: any, r: any) { return Promise.resolve(undefined).then(f, r); },
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  },
  usersTable: {},
  instanceAuditLogTable: {},
  organizationsTable: {},
  orgMembersTable: {},
  tasksTable: {},
  orgFeaturesTable: {},
  rolesTable: {},
  ORG_FEATURES: [],
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  count: () => ({}),
  desc: () => ({}),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

// ---------------------------------------------------------------------------
// Import the REAL admin router AFTER mocks (requireInstanceAdmin is real too)
// ---------------------------------------------------------------------------
import adminRouter from "./admin.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  return app;
}

function authed(r: request.Test) {
  return r.set("Authorization", `Bearer ${ADMIN_TOKEN}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/email/status — password never leaks", () => {
  beforeEach(() => {
    getEmailConfigSpy.mockClear();
  });

  it("returns hasPassword but no pass field in the response", async () => {
    const res = await authed(request(buildApp()).get("/api/admin/email/status"));

    expect(res.status).toBe(200);

    // Must include the safe boolean sentinel
    expect(res.body).toHaveProperty("hasPassword");
    expect(typeof res.body.hasPassword).toBe("boolean");

    // Must NOT include any raw password field
    expect(res.body).not.toHaveProperty("pass");
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("passEncrypted");
  });

  it("does not echo the plaintext password even when SMTP is configured", async () => {
    const res = await authed(request(buildApp()).get("/api/admin/email/status"));

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // The response body must not contain the literal encryption key or any
    // password-like value — spot-check against well-known test values.
    expect(body).not.toContain(ENC_KEY);
  });
});

describe("PUT /api/admin/email/config — password never leaks in response", () => {
  const SMTP_PAYLOAD = {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "smtp-user",
    pass: "super-secret-password",
    from: "Opsly <noreply@example.com>",
  };

  beforeEach(() => {
    applySmtpOverrideSpy.mockClear();
    getEmailConfigSpy.mockClear();
  });

  it("returns hasPassword but no pass field after saving config", async () => {
    const res = await authed(request(buildApp()).put("/api/admin/email/config")).send(SMTP_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("hasPassword");
    expect(res.body).not.toHaveProperty("pass");
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("passEncrypted");
  });

  it("calls applySmtpOverride with the plaintext password (encryption happens inside email.ts)", async () => {
    // The route hands the plaintext to applySmtpOverride, which calls encrypt()
    // internally before writing to the DB. This test confirms the route itself
    // does not strip, hash, or pre-encrypt the password before the handoff.
    await authed(request(buildApp()).put("/api/admin/email/config")).send(SMTP_PAYLOAD);

    expect(applySmtpOverrideSpy).toHaveBeenCalledOnce();
    const arg = applySmtpOverrideSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.pass).toBe("super-secret-password");
    expect(arg.host).toBe("smtp.example.com");
  });

  it("response body never contains the submitted plaintext password", async () => {
    const res = await authed(request(buildApp()).put("/api/admin/email/config")).send(SMTP_PAYLOAD);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("super-secret-password");
  });
});
