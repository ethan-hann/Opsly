/**
 * Integration tests — suspended org (isDisabled: true) is blocked at the
 * requireOrgOrApiKey middleware layer.
 *
 * The real requireOrgOrApiKey middleware runs here (NOT mocked). @workspace/db
 * is mocked so no live database is required. The tests prime the select queue
 * to return a membership or org row with isDisabled: true and assert that the
 * middleware returns 403 with error: 'org_suspended' before the route handler
 * is ever reached.
 *
 * Two auth paths exercised:
 *  1. Session-user path  — req.user is set, DB returns membership with isDisabled: true
 *  2. API-key path       — req.apiKeyId is set, DB returns org with isDisabled: true
 *
 * A passing (isDisabled: false) case is included for each path to confirm the
 * middleware correctly calls next() when the org is active.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Shared mock state — selectQueue drives the DB mock
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// The middleware uses:
//   Session path: db.select(...).from(...).innerJoin(...).innerJoin(...).where(...).limit(1)
//   API-key path: db.select(...).from(...).where(...).limit(1)
// The fluent chain just needs to resolve to whatever selectQueue holds.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(result).catch(onrejected);
      },
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
    },
    orgMembersTable: {},
    organizationsTable: {},
    rolesTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
}));

// ---------------------------------------------------------------------------
// Import the REAL middleware after mocks are hoisted
// ---------------------------------------------------------------------------
import { requireOrgOrApiKey } from "../middlewares/requireOrgMiddleware.js";

// ---------------------------------------------------------------------------
// A stub membership row with an active org — used for the "passes through" cases
// ---------------------------------------------------------------------------
const ACTIVE_MEMBERSHIP = {
  orgId: "org-1",
  roleId: "role-member",
  roleName: "Member",
  isOwner: false,
  permissions: {},
  isDisabled: false,
};

// ---------------------------------------------------------------------------
// App factory
//
// Builds a minimal Express app that:
//   1. Optionally injects req.user (session path) or req.apiKeyId+req.orgId (API-key path)
//   2. Runs the real requireOrgOrApiKey middleware
//   3. Falls through to a stub handler that returns 200 { ok: true }
//
// The stub handler is only reached when the middleware calls next().
// ---------------------------------------------------------------------------
function buildSessionApp(sessionUser = { id: "user-1" }) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = sessionUser as any;
    next();
  });
  app.use(requireOrgOrApiKey);
  app.use((_req: Request, res: Response) => res.json({ ok: true }));
  return app;
}

function buildApiKeyApp(orgId = "org-1", apiKeyId = "key-1") {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).apiKeyId = apiKeyId;
    req.orgId = orgId;
    next();
  });
  app.use(requireOrgOrApiKey);
  app.use((_req: Request, res: Response) => res.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Tests — session-user path
// ---------------------------------------------------------------------------
describe("requireOrgOrApiKey — session path — suspended org", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 403 org_suspended when membership.isDisabled is true", async () => {
    mockState.selectQueue.push([{ ...ACTIVE_MEMBERSHIP, isDisabled: true }]);

    const res = await request(buildSessionApp()).get("/any-route");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("org_suspended");
  });

  it("calls next() and returns 200 when membership.isDisabled is false", async () => {
    mockState.selectQueue.push([ACTIVE_MEMBERSHIP]);

    const res = await request(buildSessionApp()).get("/any-route");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 403 org_suspended regardless of the route path being accessed", async () => {
    // The block fires in the middleware before reaching any route handler,
    // so it applies to every endpoint — not just a specific path.
    mockState.selectQueue.push([{ ...ACTIVE_MEMBERSHIP, isDisabled: true }]);

    const res = await request(buildSessionApp()).post("/api/tasks");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("org_suspended");
  });

  it("returns 401 when there is no session user (unrelated to suspension)", async () => {
    // Confirms the middleware guards correctly even when there is no user at all.
    const app = express();
    app.use(express.json());
    // No user injection — req.user remains undefined
    app.use(requireOrgOrApiKey);
    app.use((_req: Request, res: Response) => res.json({ ok: true }));

    const res = await request(app).get("/any-route");

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests — API-key path
// ---------------------------------------------------------------------------
describe("requireOrgOrApiKey — API-key path — suspended org", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 403 org_suspended when org.isDisabled is true", async () => {
    mockState.selectQueue.push([{ isDisabled: true }]);

    const res = await request(buildApiKeyApp()).get("/any-route");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("org_suspended");
  });

  it("calls next() and returns 200 when org.isDisabled is false", async () => {
    mockState.selectQueue.push([{ isDisabled: false }]);

    const res = await request(buildApiKeyApp()).get("/any-route");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
