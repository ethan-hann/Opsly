/**
 * Tests confirming POST /api/admin/email/test sends an email whose subject
 * and body both carry the "Opsly" brand name, not "IT Task Manager" or any
 * other placeholder.
 *
 * Uses the Bearer-token path of requireInstanceAdmin to bypass session auth.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------
const ADMIN_TOKEN = "test-admin-token-email-branding";

beforeAll(() => {
  process.env["INSTANCE_ADMIN_TOKEN"] = ADMIN_TOKEN;
});

afterAll(() => {
  delete process.env["INSTANCE_ADMIN_TOKEN"];
});

// ---------------------------------------------------------------------------
// Spies
// ---------------------------------------------------------------------------
const sendMailSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("../lib/email", () => ({
  getEmailConfig: vi.fn().mockReturnValue({
    configured: true,
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "user",
    from: "Opsly <noreply@example.com>",
    source: "env",
    hasPassword: false,
  }),
  sendMail: sendMailSpy,
  applySmtpOverride: vi.fn().mockResolvedValue(undefined),
  clearSmtpOverride: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/admin/email/test — Opsly branding in subject and body", () => {
  beforeEach(() => {
    sendMailSpy.mockClear();
  });

  it("calls sendMail with a subject containing 'Opsly'", async () => {
    const res = await authed(
      request(buildApp()).post("/api/admin/email/test"),
    ).send({ to: "admin@example.com" });

    expect(res.status).toBe(200);
    expect(sendMailSpy).toHaveBeenCalledOnce();

    const { subject } = sendMailSpy.mock.calls[0][0] as { subject: string; html: string; to: string };
    expect(subject).toContain("Opsly");
  });

  it("subject does not contain 'IT Task Manager'", async () => {
    await authed(request(buildApp()).post("/api/admin/email/test")).send({ to: "admin@example.com" });

    const { subject } = sendMailSpy.mock.calls[0][0] as { subject: string; html: string; to: string };
    expect(subject).not.toContain("IT Task Manager");
  });

  it("calls sendMail with an HTML body containing 'Opsly'", async () => {
    await authed(request(buildApp()).post("/api/admin/email/test")).send({ to: "admin@example.com" });

    const { html } = sendMailSpy.mock.calls[0][0] as { subject: string; html: string; to: string };
    expect(html).toContain("Opsly");
  });

  it("HTML body does not contain 'IT Task Manager'", async () => {
    await authed(request(buildApp()).post("/api/admin/email/test")).send({ to: "admin@example.com" });

    const { html } = sendMailSpy.mock.calls[0][0] as { subject: string; html: string; to: string };
    expect(html).not.toContain("IT Task Manager");
  });

  it("sends to the provided 'to' address", async () => {
    await authed(request(buildApp()).post("/api/admin/email/test")).send({ to: "recipient@example.com" });

    const { to } = sendMailSpy.mock.calls[0][0] as { subject: string; html: string; to: string };
    expect(to).toBe("recipient@example.com");
  });

  it("returns 400 when 'to' is missing", async () => {
    const res = await authed(request(buildApp()).post("/api/admin/email/test")).send({});

    expect(res.status).toBe(400);
    expect(sendMailSpy).not.toHaveBeenCalled();
  });
});
