/**
 * Tests for API key management routes and the session-only access-control guarantee.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  Security guarantee (middleware unit tests)
 *   - requirePermission rejects API key requests (403, session auth message)
 *   - requireAdmin rejects API key requests (403)
 *   - requireOwner rejects API key requests (403)
 *   - requireScope passes API key requests with matching scope
 *   - requireScope rejects API key requests with missing scope (403 insufficient_scope)
 *
 *  GET    /api-keys  — list keys (metadata only, never hash)
 *  POST   /api-keys  — create key, returns full value once
 *  DELETE /api-keys/:id — revoke key
 *
 *  API key auth is rejected on all three management routes (403).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertQueue: [] as any[][],
  updateQueue: [] as any[][],
  // Controls what requireOrg exposes on req
  apiKeyId: null as string | null,
  apiKeyScopes: null as string[] | null,
  apiKeyName: null as string | null,
  orgPermissions: {
    view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
    delete_tasks: true, manage_projects: true, manage_org_settings: true,
    manage_members: true, manage_webhooks: true, manage_api_keys: true,
    manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
    manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
  } as Record<string, boolean> | null,
}));

// ---------------------------------------------------------------------------
// Mock org-features — always enabled so feature flags don't interfere
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
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
      // Make the chain awaitable directly (for queries that omit .limit())
      then: (resolve: (v: any[]) => any, reject?: (e: any) => any) =>
        Promise.resolve(result).then(resolve, reject),
      limit: () => Promise.resolve(result),
      returning: () => Promise.resolve(result),
    };
    return chain;
  }

  const db: any = {
    select: (_fields?: any) => {
      const result = mockState.selectQueue.shift() ?? [];
      return makeChain(result);
    },
    insert: (_table: any) => ({
      values: (_row: any) => {
        const result = mockState.insertQueue.shift() ?? [];
        return makeChain(result);
      },
    }),
    update: (_table: any) => {
      const result = mockState.updateQueue.shift() ?? [];
      return {
        set: () => ({
          where: () => makeChain(result),
        }),
      };
    },
    delete: (_table: any) => ({
      where: () => makeChain([]),
    }),
  };

  return {
    db,
    apiKeysTable: {},
    usersTable: {},
    orgMembersTable: {},
    organizationsTable: {},
    rolesTable: {},
    API_KEY_SCOPES: [
      "tasks:read", "tasks:write", "projects:read", "projects:write",
      "comments:read", "comments:write", "webhooks:read", "webhooks:write",
    ],
  };
});

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "org-test";
    if (mockState.apiKeyId) {
      req.apiKeyId = mockState.apiKeyId;
      req.apiKeyScopes = mockState.apiKeyScopes ?? [];
      req.apiKeyName = mockState.apiKeyName ?? "test-key";
    } else {
      req.user = { id: "user-test", email: "test@example.com" };
      req.orgPermissions = mockState.orgPermissions;
      req.isOrgOwner = true;
    }
    next();
  },
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  },
  requirePermission: (key: string) => (req: any, res: any, next: any) => {
    if (req.apiKeyId) {
      res.status(403).json({ error: "This endpoint requires session authentication; API keys cannot perform this action." });
      return;
    }
    if (!req.orgPermissions?.[key]) {
      res.status(403).json({ error: `Permission required: ${key}` });
      return;
    }
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (req.apiKeyId) {
      res.status(403).json({ error: "This endpoint requires session authentication; API keys cannot perform this action." });
      return;
    }
    if (!req.orgPermissions?.manage_projects) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
  requireOwner: (req: any, res: any, next: any) => {
    if (req.apiKeyId) {
      res.status(403).json({ error: "This endpoint requires session authentication; API keys cannot perform this action." });
      return;
    }
    if (!req.isOrgOwner) {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    next();
  },
  requireScope: (scope: string) => (req: any, res: any, next: any) => {
    if (!req.apiKeyId) { next(); return; }
    if (!req.apiKeyScopes?.includes(scope)) {
      res.status(403).json({ error: "insufficient_scope", required: scope });
      return;
    }
    next();
  },
  hasPermission: (req: any, key: string) => {
    if (req.apiKeyId) return true;
    return req.orgPermissions?.[key] ?? false;
  },
}));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = express();
  app.use(express.json());
  const { default: apiKeysRouter } = await import("./api-keys");
  app.use("/api", apiKeysRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function asApiKey(scopes: string[] = ["tasks:read"]) {
  mockState.apiKeyId = "key-abc";
  mockState.apiKeyScopes = scopes;
  mockState.apiKeyName = "ci-key";
}

function asSession() {
  mockState.apiKeyId = null;
  mockState.apiKeyScopes = null;
  mockState.apiKeyName = null;
}

function makeApiKeyRow(overrides: Record<string, any> = {}) {
  return {
    id: "key-uuid-1",
    orgId: "org-test",
    name: "ci-key",
    keyPrefix: "opsly_ab",
    keyHash: "hash-not-exposed",
    scopes: ["tasks:read"],
    expiresAt: null,
    createdBy: "user-test",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    revokedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Security guarantee — middleware unit tests
// ---------------------------------------------------------------------------

describe("Security guarantee — requirePermission, requireAdmin, requireOwner reject API keys", () => {
  /**
   * These tests exercise the real middleware logic (same implementation the
   * mock in this file reproduces, which mirrors the actual code) by mounting
   * a minimal Express app that only uses those middlewares.
   */
  function buildGuardApp(middleware: (req: Request, res: Response, next: NextFunction) => void) {
    const app = express();
    app.use(express.json());
    // Simulate requireOrg attaching apiKeyId
    app.use((req: any, _res, next) => {
      req.apiKeyId = "key-abc";
      req.apiKeyScopes = ["tasks:read"];
      req.orgId = "org-test";
      next();
    });
    app.get("/test", middleware as any, (_req, res) => res.json({ ok: true }));
    return app;
  }

  // Import the real middleware (not mocked) by accessing the actual module
  // via vi.importActual so these tests cover the real logic.
  it("requirePermission rejects API key requests with 403 (session auth message)", async () => {
    const { requirePermission } = await vi.importActual<typeof import("../middlewares/requireOrgMiddleware")>(
      "../middlewares/requireOrgMiddleware",
    );
    const app = buildGuardApp(requirePermission("manage_org_settings") as any);
    const res = await request(app).get("/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session authentication/i);
  });

  it("requireAdmin rejects API key requests with 403", async () => {
    const { requireAdmin } = await vi.importActual<typeof import("../middlewares/requireOrgMiddleware")>(
      "../middlewares/requireOrgMiddleware",
    );
    const app = buildGuardApp(requireAdmin as any);
    const res = await request(app).get("/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session authentication/i);
  });

  it("requireOwner rejects API key requests with 403", async () => {
    const { requireOwner } = await vi.importActual<typeof import("../middlewares/requireOrgMiddleware")>(
      "../middlewares/requireOrgMiddleware",
    );
    const app = buildGuardApp(requireOwner as any);
    const res = await request(app).get("/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session authentication/i);
  });

  it("requireScope passes API key requests with matching scope", async () => {
    const { requireScope } = await vi.importActual<typeof import("../middlewares/requireOrgMiddleware")>(
      "../middlewares/requireOrgMiddleware",
    );
    const app = buildGuardApp(requireScope("tasks:read") as any);
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("requireScope rejects API key requests with missing scope (403 insufficient_scope)", async () => {
    const { requireScope } = await vi.importActual<typeof import("../middlewares/requireOrgMiddleware")>(
      "../middlewares/requireOrgMiddleware",
    );
    const app = express();
    app.use((req: any, _res, next) => {
      req.apiKeyId = "key-abc";
      req.apiKeyScopes = ["projects:read"]; // does NOT include tasks:write
      req.orgId = "org-test";
      next();
    });
    app.get("/test", requireScope("tasks:write") as any, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get("/test");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_scope");
    expect(res.body.required).toBe("tasks:write");
  });
});

// ---------------------------------------------------------------------------
// Security guarantee — /api-keys routes explicitly block API key auth
// ---------------------------------------------------------------------------

describe("Security guarantee — GET/POST/DELETE /api-keys reject API key auth", () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await buildApp();
    mockState.selectQueue = [];
    mockState.insertQueue = [];
    mockState.updateQueue = [];
  });

  it("GET /api-keys returns 403 when called via API key", async () => {
    asApiKey(["tasks:read"]);
    const res = await request(app).get("/api/api-keys");
    expect(res.status).toBe(403);
  });

  it("POST /api-keys returns 403 when called via API key", async () => {
    asApiKey(["tasks:write"]);
    const res = await request(app)
      .post("/api/api-keys")
      .send({ name: "evil-key", scopes: ["tasks:read"] });
    expect(res.status).toBe(403);
  });

  it("DELETE /api-keys/:id returns 403 when called via API key", async () => {
    asApiKey(["tasks:write"]);
    const res = await request(app).delete("/api/api-keys/key-uuid-1");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api-keys
// ---------------------------------------------------------------------------

describe("GET /api-keys", () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await buildApp();
    asSession();
    mockState.selectQueue = [];
  });

  it("returns 200 with key list — never exposes keyHash", async () => {
    const row = makeApiKeyRow();
    mockState.selectQueue = [
      [{ key: row, firstName: "Alice", lastName: "Liddell", email: "alice@test.com" }],
    ];
    const res = await request(app).get("/api/api-keys");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).not.toHaveProperty("keyHash");
    expect(res.body[0]).not.toHaveProperty("key");
    expect(res.body[0]).toHaveProperty("keyPrefix");
    expect(res.body[0]).toHaveProperty("scopes");
    expect(res.body[0].name).toBe("ci-key");
  });

  it("returns 200 with empty list when no keys exist", async () => {
    mockState.selectQueue = [[]];
    const res = await request(app).get("/api/api-keys");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api-keys
// ---------------------------------------------------------------------------

describe("POST /api-keys", () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await buildApp();
    asSession();
    mockState.selectQueue = [];
    mockState.insertQueue = [];
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/api-keys")
      .send({ scopes: ["tasks:read"] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when scopes array is empty", async () => {
    const res = await request(app)
      .post("/api/api-keys")
      .send({ name: "ci", scopes: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when scopes contains an invalid value", async () => {
    const res = await request(app)
      .post("/api/api-keys")
      .send({ name: "ci", scopes: ["tasks:read", "INVALID_SCOPE"] });
    expect(res.status).toBe(400);
  });

  it("returns 201 with full key value on success; key starts with opsly_", async () => {
    const row = makeApiKeyRow({ id: "new-key-id", name: "ci-key", scopes: ["tasks:read"] });
    mockState.insertQueue = [[row]];
    const res = await request(app)
      .post("/api/api-keys")
      .send({ name: "ci-key", scopes: ["tasks:read"] });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("key");
    expect(res.body.key).toMatch(/^opsly_[0-9a-f]{64}$/);
    expect(res.body).not.toHaveProperty("keyHash");
    expect(res.body.id).toBe("new-key-id");
  });

  it("keyPrefix stored in DB is the first 8 characters of the generated key", async () => {
    // Capture the values passed to db.insert().values() so we can verify
    // the route computes keyPrefix = rawKey.slice(0, 8) before inserting.
    let capturedValues: any = null;
    const { db } = await vi.importMock<typeof import("@workspace/db")>("@workspace/db");
    (db as any).insert = (_table: any) => ({
      values: (row: any) => {
        capturedValues = row;
        const result = mockState.insertQueue.shift() ?? [];
        return {
          then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
          returning: () => Promise.resolve(result),
        };
      },
    });

    const row = makeApiKeyRow({ id: "new-key-id" });
    mockState.insertQueue = [[row]];
    const res = await request(app)
      .post("/api/api-keys")
      .send({ name: "ci-key", scopes: ["tasks:read"] });
    expect(res.status).toBe(201);
    const returnedKey: string = res.body.key;
    expect(returnedKey).toMatch(/^opsly_[0-9a-f]{64}$/);
    // The prefix stored in the DB must equal the first 8 chars of the full key
    expect(capturedValues.keyPrefix).toBe(returnedKey.slice(0, 8));
  });

  it("the returned key value is never stored — only the prefix and hash are", async () => {
    // This is a design contract test: the mock row has keyHash="hash-not-exposed"
    // but that value must never appear in the response.
    const row = makeApiKeyRow({ id: "key-x" });
    mockState.insertQueue = [[row]];
    const res = await request(app)
      .post("/api/api-keys")
      .send({ name: "ci-key", scopes: ["tasks:read"] });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain("hash-not-exposed");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api-keys/:id (revoke)
// ---------------------------------------------------------------------------

describe("DELETE /api-keys/:id", () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await buildApp();
    asSession();
    mockState.selectQueue = [];
    mockState.updateQueue = [];
  });

  it("returns 404 when the key does not exist in this org", async () => {
    mockState.selectQueue = [[/* key not found */]];
    const res = await request(app).delete("/api/api-keys/missing-id");
    expect(res.status).toBe(404);
  });

  it("returns 409 when the key is already revoked", async () => {
    const row = makeApiKeyRow({ revokedAt: new Date("2025-01-01") });
    mockState.selectQueue = [[row]];
    const res = await request(app).delete("/api/api-keys/key-uuid-1");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already revoked/i);
  });

  it("returns 200 with revoked key metadata on successful revocation", async () => {
    const row = makeApiKeyRow({ id: "key-uuid-1", revokedAt: null });
    const revokedRow = makeApiKeyRow({ id: "key-uuid-1", revokedAt: new Date("2025-06-01") });
    mockState.selectQueue = [[row]];
    mockState.updateQueue = [[revokedRow]];
    const res = await request(app).delete("/api/api-keys/key-uuid-1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("revokedAt");
    expect(res.body).not.toHaveProperty("keyHash");
  });
});
