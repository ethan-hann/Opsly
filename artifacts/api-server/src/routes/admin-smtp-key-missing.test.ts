/**
 * Tests confirming PUT /api/admin/email/config returns a clear 500 with a
 * descriptive message when SECRET_ENCRYPTION_KEY is missing, rather than
 * letting the raw crypto error surface as an unhandled exception.
 *
 * Uses the Bearer-token path of requireInstanceAdmin to bypass session auth.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Environment setup — Bearer token auth, no encryption key
// ---------------------------------------------------------------------------
const ADMIN_TOKEN = "test-admin-token-key-missing";

beforeAll(() => {
  process.env["INSTANCE_ADMIN_TOKEN"] = ADMIN_TOKEN;
  // Deliberately omit SECRET_ENCRYPTION_KEY to exercise the missing-key path
  delete process.env["SECRET_ENCRYPTION_KEY"];
});

afterAll(() => {
  delete process.env["INSTANCE_ADMIN_TOKEN"];
});

// ---------------------------------------------------------------------------
// applySmtpOverride throws the descriptive missing-key error
// ---------------------------------------------------------------------------
const applySmtpOverrideSpy = vi.hoisted(() =>
  vi.fn().mockRejectedValue(
    new Error(
      "SECRET_ENCRYPTION_KEY is not set. Cannot encrypt the SMTP password. " +
        "Set the SECRET_ENCRYPTION_KEY environment variable and restart the server.",
    ),
  ),
);

const getEmailConfigSpy = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    configured: false,
    host: "",
    port: 587,
    secure: false,
    user: "",
    from: "",
    source: "env",
    hasPassword: false,
  }),
);

vi.mock("../lib/email", () => ({
  getEmailConfig: getEmailConfigSpy,
  applySmtpOverride: applySmtpOverrideSpy,
  clearSmtpOverride: vi.fn().mockResolvedValue(undefined),
  sendMail: vi.fn().mockResolvedValue({ ok: true }),
  isEmailConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      const c: any = {
        from: () => c, where: () => c, limit: () => Promise.resolve([]),
        then(f: any, r: any) { return Promise.resolve([]).then(f, r); },
      };
      return c;
    },
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
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
  eq: () => ({}), and: () => ({}), count: () => ({}), desc: () => ({}),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

import adminRouter from "./admin.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  return app;
}

function authed(r: request.Test) {
  return r.set("Authorization", `Bearer ${ADMIN_TOKEN}`);
}

const VALID_SMTP_BODY = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "smtp-user",
  pass: "super-secret",
  from: "Opsly <noreply@example.com>",
};

describe("PUT /api/admin/email/config — missing SECRET_ENCRYPTION_KEY", () => {
  beforeEach(() => {
    applySmtpOverrideSpy.mockClear();
    getEmailConfigSpy.mockClear();
  });

  it("returns 500 (not an unhandled crash) when the encryption key is absent", async () => {
    const res = await authed(
      request(buildApp()).put("/api/admin/email/config"),
    ).send(VALID_SMTP_BODY);

    expect(res.status).toBe(500);
  });

  it("response body contains a human-readable error about SECRET_ENCRYPTION_KEY", async () => {
    const res = await authed(
      request(buildApp()).put("/api/admin/email/config"),
    ).send(VALID_SMTP_BODY);

    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toMatch(/SECRET_ENCRYPTION_KEY/i);
  });

  it("response body does not echo back the submitted password", async () => {
    const res = await authed(
      request(buildApp()).put("/api/admin/email/config"),
    ).send(VALID_SMTP_BODY);

    expect(JSON.stringify(res.body)).not.toContain("super-secret");
  });

  it("still returns 400 for invalid body (key check is never reached)", async () => {
    const res = await authed(
      request(buildApp()).put("/api/admin/email/config"),
    ).send({ port: 587, secure: false, from: "x@x.com" }); // missing host

    expect(res.status).toBe(400);
    // applySmtpOverride must not be called on validation failure
    expect(applySmtpOverrideSpy).not.toHaveBeenCalled();
  });
});
