/**
 * Regression tests: suspended org blocks BOTH session users and API key callers.
 *
 * requireOrgOrApiKey must reject requests from any auth method when the org's
 * isDisabled flag is true — this prevents a suspended org from still reaching
 * API-key-enabled routes (webhooks, export, custom-fields, etc.).
 *
 * Covers:
 *  - Session user in suspended org → 403 org_suspended
 *  - API key from suspended org → 403 org_suspended
 *  - API key from active org → passes through (200)
 *  - Session user in active org → passes through (200)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response } from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  /** Whether the org returned by the DB mock is suspended */
  orgDisabled: false,
  /** When true the request is treated as an API key request */
  isApiKey: false,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: unknown[]): unknown {
    const resolved = Promise.resolve(result);
    const chain: Record<string, unknown> = {};
    const noop = () => chain;
    chain.from = noop;
    chain.where = noop;
    chain.innerJoin = noop;
    chain.leftJoin = noop;
    chain.orderBy = noop;
    chain.groupBy = noop;
    chain.limit = () => resolved;
    chain.then = (onFulfilled: unknown, onRejected: unknown) =>
      resolved.then(onFulfilled as never, onRejected as never);
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => {
      // Return org row reflecting current disabled state
      const row = { isDisabled: mockState.orgDisabled, orgId: "org-test",
        roleId: "role-1", roleName: "Member", isOwner: false,
        permissions: { manage_org_settings: true } };
      return makeChain([row]);
    },
  };

  return {
    db,
    orgMembersTable: {},
    organizationsTable: {},
    rolesTable: {},
  };
});

// ---------------------------------------------------------------------------
// Build a minimal express app with requireOrgOrApiKey on a test route
// ---------------------------------------------------------------------------
async function buildApp() {
  const { requireOrgOrApiKey } = await import("../middlewares/requireOrgMiddleware");
  const app = express();

  // Simulate authMiddleware: inject user/apiKey onto req
  app.use((req: Request, _res: Response, next) => {
    req.orgId = "org-test";
    if (mockState.isApiKey) {
      (req as any).apiKeyId = "key-abc";
      (req as any).apiKeyScopes = ["tasks:read", "tasks:write"];
    } else {
      (req as any).user = { id: "user-1", email: "u@example.com" };
    }
    next();
  });

  app.get("/test", requireOrgOrApiKey, (_req, res) => res.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("requireOrgOrApiKey — org suspension enforcement", () => {
  beforeEach(() => {
    mockState.orgDisabled = false;
    mockState.isApiKey = false;
    vi.resetModules();
  });

  it("session user in active org passes through (200)", async () => {
    const app = await buildApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("session user in suspended org is blocked (403 org_suspended)", async () => {
    mockState.orgDisabled = true;
    const app = await buildApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("org_suspended");
  });

  it("API key from active org passes through (200)", async () => {
    mockState.isApiKey = true;
    const app = await buildApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("API key from suspended org is blocked (403 org_suspended)", async () => {
    mockState.isApiKey = true;
    mockState.orgDisabled = true;
    const app = await buildApp();
    const res = await request(app).get("/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("org_suspended");
  });
});
