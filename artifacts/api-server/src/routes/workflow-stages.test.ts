/**
 * Tests for workflow-stages routes — member permission enforcement.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /workflow-stages           — accessible to all org members (read-only)
 *  - POST /workflow-stages           — 403 for plain members, 201 for admins
 *  - POST /workflow-stages/reorder   — 403 for plain members, 204 for admins
 *  - PATCH /workflow-stages/:id      — 403 for plain members, 200 for admins
 *  - DELETE /workflow-stages/:id     — 403 for plain members
 *  - Body role injection             — role: "admin" in body never elevates privileges
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertResult: [] as any[],
  updateResult: [] as any[],
  /** When false, requirePermission("manage_workflow_stages") blocks with 403 */
  canManageStages: true,
  orgId: "test-org",
}));

// ---------------------------------------------------------------------------
// Mock org-features — always enabled so feature flags don't interfere
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

// ---------------------------------------------------------------------------
// Mock ../lib/workflow-stages — getOrSeedStages returns the selectQueue head
// ---------------------------------------------------------------------------
vi.mock("../lib/workflow-stages", () => ({
  getOrSeedStages: async () => mockState.selectQueue.shift() ?? [],
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
      limit: () => Promise.resolve(result),
      orderBy: () => chain,
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(result).catch(onrejected);
      },
    };
    return chain;
  }

  const dbMock: any = {
    select: () => makeChain(mockState.selectQueue.shift() ?? []),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockState.insertResult),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockState.updateResult),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };

  return {
    db: dbMock,
    workflowStagesTable: {},
    tasksTable: {},
  };
});

vi.mock("../lib/log-org-event", () => ({
  logOrgEvent: async () => undefined,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  sql: Object.assign(
    (_strings: any, ..._values: any[]) => ({ _isSql: true }),
    {
      join: () => ({ _isSql: true }),
      raw: () => ({ _isSql: true }),
      param: () => ({ _isSql: true }),
    },
  ),
}));

// ---------------------------------------------------------------------------
// Mock @workspace/api-zod — passthrough schemas
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => {
  const p = {
    parse: (x: any) => x,
    safeParse: (x: any) => ({ success: true, data: x }),
  };
  return {
    ListWorkflowStagesResponse: p,
    CreateWorkflowStageBody: p,
    CreateWorkflowStageResponse: p,
    UpdateWorkflowStageParams: p,
    UpdateWorkflowStageBody: p,
    UpdateWorkflowStageResponse: p,
    RemoveWorkflowStageParams: p,
    ReorderWorkflowStagesBody: p,
  };
});

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = mockState.orgId;
    req.user = { id: "user-1", email: "user@example.com" };
    req.orgPermissions = { manage_workflow_stages: mockState.canManageStages };
    next();
  },
  requirePermission: (key: string) => (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.[key]) {
      res.status(403).json({ error: `Permission required: ${key}` });
      return;
    }
    next();
  },
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
}));

import workflowStagesRouter from "./workflow-stages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", workflowStagesRouter);
  return app;
}

const MOCK_STAGE = {
  id: 1,
  orgId: "test-org",
  name: "In Progress",
  color: "#3b82f6",
  type: "open",
  position: 0,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// GET /api/workflow-stages — readable by all org members
// ---------------------------------------------------------------------------

describe("GET /api/workflow-stages", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.canManageStages = true;
  });

  it("returns 200 for an admin member", async () => {
    mockState.selectQueue.push([MOCK_STAGE]);
    const res = await request(buildApp()).get("/api/workflow-stages");
    expect(res.status).toBe(200);
  });

  it("returns 200 for a plain member (read is not gated)", async () => {
    mockState.canManageStages = false;
    mockState.selectQueue.push([MOCK_STAGE]);
    const res = await request(buildApp()).get("/api/workflow-stages");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/workflow-stages — admin only
// ---------------------------------------------------------------------------

describe("POST /api/workflow-stages", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.canManageStages = true;
  });

  it("returns 403 when a plain member tries to create a stage", async () => {
    mockState.canManageStages = false;
    const res = await request(buildApp())
      .post("/api/workflow-stages")
      .send({ name: "Review", color: "#f59e0b", type: "open" });
    expect(res.status).toBe(403);
  });

  it("returns 201 when an admin creates a stage", async () => {
    mockState.selectQueue.push([{ maxPos: 2 }]); // position calculation
    mockState.insertResult = [MOCK_STAGE];
    const res = await request(buildApp())
      .post("/api/workflow-stages")
      .send({ name: "In Progress", color: "#3b82f6", type: "open" });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// POST /api/workflow-stages/reorder — admin only
// ---------------------------------------------------------------------------

describe("POST /api/workflow-stages/reorder", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.canManageStages = true;
  });

  it("returns 403 when a plain member tries to reorder stages", async () => {
    mockState.canManageStages = false;
    const res = await request(buildApp())
      .post("/api/workflow-stages/reorder")
      .send({ ids: [2, 1, 3] });
    expect(res.status).toBe(403);
  });

  it("returns 204 when an admin reorders stages", async () => {
    const res = await request(buildApp())
      .post("/api/workflow-stages/reorder")
      .send({ ids: [2, 1, 3] });
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/workflow-stages/:id — admin only
// ---------------------------------------------------------------------------

describe("PATCH /api/workflow-stages/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateResult = [];
    mockState.canManageStages = true;
  });

  it("returns 403 when a plain member tries to update a stage", async () => {
    mockState.canManageStages = false;
    const res = await request(buildApp())
      .patch("/api/workflow-stages/1")
      .send({ name: "Sneaky Rename" });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the stage does not exist in the org", async () => {
    // DB returns no row for the existing stage lookup
    const res = await request(buildApp())
      .patch("/api/workflow-stages/999")
      .send({ name: "Ghost Stage" });
    expect(res.status).toBe(404);
  });

  it("returns 200 when an admin renames an existing stage", async () => {
    mockState.selectQueue.push([MOCK_STAGE]); // existing stage lookup
    mockState.updateResult = [{ ...MOCK_STAGE, name: "Updated" }];
    const res = await request(buildApp())
      .patch("/api/workflow-stages/1")
      .send({ name: "Updated" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/workflow-stages/:id — admin only
// ---------------------------------------------------------------------------

describe("DELETE /api/workflow-stages/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.canManageStages = true;
  });

  it("returns 403 when a plain member tries to delete a stage", async () => {
    mockState.canManageStages = false;
    const res = await request(buildApp()).delete("/api/workflow-stages/1");
    expect(res.status).toBe(403);
  });

  it("returns 404 when the stage does not exist in the org", async () => {
    // DB returns no row for the stage lookup
    const res = await request(buildApp())
      .delete("/api/workflow-stages/999")
      .query({ reassignTo: "2" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Body role injection — role: "admin" in the request body must never elevate
// privileges.  Authorization derives entirely from req.orgPermissions (set by
// requireOrgMiddleware from the DB membership row), not from any body field.
// ---------------------------------------------------------------------------

describe("Body 'role' field injection — role: admin in request body never elevates privileges", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    // Caller is a plain member with no manage_workflow_stages permission.
    mockState.canManageStages = false;
  });

  it("POST /workflow-stages — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .post("/api/workflow-stages")
      .send({ name: "Sneaky Stage", color: "#ff0000", type: "open", role: "admin" });
    expect(res.status).toBe(403);
  });

  it("POST /workflow-stages/reorder — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .post("/api/workflow-stages/reorder")
      .send({ ids: [1, 2], role: "admin" });
    expect(res.status).toBe(403);
  });

  it("PATCH /workflow-stages/:id — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .patch("/api/workflow-stages/1")
      .send({ name: "Sneaky Rename", role: "admin" });
    expect(res.status).toBe(403);
  });

  it("DELETE /workflow-stages/:id — returns 403 even when body includes role: 'admin'", async () => {
    const res = await request(buildApp())
      .delete("/api/workflow-stages/1")
      .send({ role: "admin" });
    expect(res.status).toBe(403);
  });
});
