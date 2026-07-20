/**
 * Integration smoke tests — admin route 401 coverage.
 *
 * These tests mount the REAL admin router with the REAL requireInstanceAdmin
 * middleware (NOT mocked). The only things mocked are @workspace/db (no live
 * DB needed) and ../lib/email. The purpose is to catch any admin endpoint
 * that forgets to apply the middleware: if a route were accidentally left
 * unguarded, a bare request would return 200/404/500 instead of 401 and the
 * test would fail.
 *
 * Covered routes (every route registered in admin.ts):
 *  GET    /api/admin/me
 *  GET    /api/admin/orgs
 *  PATCH  /api/admin/orgs/:id
 *  DELETE /api/admin/orgs/:id
 *  GET    /api/admin/orgs/:id/features
 *  PATCH  /api/admin/orgs/:id/features
 *  GET    /api/admin/users
 *  DELETE /api/admin/orgs/:orgId/members/:userId
 *  GET    /api/admin/usage
 *  GET    /api/admin/email/status
 *  POST   /api/admin/email/test
 *  GET    /api/admin/audit-log
 */

import { vi, describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock @workspace/db — admin.ts and requireInstanceAdmin both import from here.
// The middleware only touches the DB on the session-user path (which we never
// reach because we send no session). The router handlers are never reached
// either (401 fires first). A minimal fluent chain is sufficient.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve([]),
    then(onfulfilled: any, onrejected: any) {
      return Promise.resolve([]).then(onfulfilled, onrejected);
    },
  };
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]), onConflictDoUpdate: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    },
    organizationsTable: {},
    orgMembersTable: {},
    tasksTable: {},
    usersTable: {},
    orgFeaturesTable: {},
    instanceAuditLogTable: {},
    rolesTable: {},
    ORG_FEATURES: ["feature_a", "feature_b"],
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  count: () => ({}),
  desc: () => ({}),
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

// Mock email helpers so POST /admin/email/test doesn't need SMTP env vars.
vi.mock("../lib/email", () => ({
  getEmailConfig: () => ({ configured: false, from: "", host: "", port: 0 }),
  sendMail: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the REAL admin router AFTER mocks are hoisted.
// requireInstanceAdmin is NOT mocked — the real implementation runs.
// ---------------------------------------------------------------------------
import adminRouter from "./admin.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  // The main server mounts the router at /api. Routes inside admin.ts are
  // registered as /admin/*, so effective paths become /api/admin/*.
  app.use("/api", adminRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: assert that every listed route returns 401 when called with no auth.
// ---------------------------------------------------------------------------
async function assert401(method: "get" | "post" | "patch" | "delete", path: string) {
  const res = await request(buildApp())[method](path);
  expect(res.status, `${method.toUpperCase()} ${path} should be 401 without auth`).toBe(401);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Admin routes — unauthenticated requests must return 401", () => {
  it("GET /api/admin/me → 401", () =>
    assert401("get", "/api/admin/me"));

  it("GET /api/admin/orgs → 401", () =>
    assert401("get", "/api/admin/orgs"));

  it("PATCH /api/admin/orgs/:id → 401", () =>
    assert401("patch", "/api/admin/orgs/some-org-id"));

  it("DELETE /api/admin/orgs/:id → 401", () =>
    assert401("delete", "/api/admin/orgs/some-org-id"));

  it("GET /api/admin/orgs/:id/features → 401", () =>
    assert401("get", "/api/admin/orgs/some-org-id/features"));

  it("PATCH /api/admin/orgs/:id/features → 401", () =>
    assert401("patch", "/api/admin/orgs/some-org-id/features"));

  it("GET /api/admin/users → 401", () =>
    assert401("get", "/api/admin/users"));

  it("DELETE /api/admin/orgs/:orgId/members/:userId → 401", () =>
    assert401("delete", "/api/admin/orgs/some-org-id/members/some-user-id"));

  it("GET /api/admin/usage → 401", () =>
    assert401("get", "/api/admin/usage"));

  it("GET /api/admin/email/status → 401", () =>
    assert401("get", "/api/admin/email/status"));

  it("POST /api/admin/email/test → 401", () =>
    assert401("post", "/api/admin/email/test"));

  it("GET /api/admin/audit-log → 401", () =>
    assert401("get", "/api/admin/audit-log"));
});
