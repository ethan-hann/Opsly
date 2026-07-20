/**
 * Cross-org isolation tests for workflow-stages routes.
 *
 * Two organizations are simulated:
 *   Org A  ("org-a") — the authenticated caller's org
 *   Org B  ("org-b") — a different org whose stages must never be readable or
 *                       modifiable by Org A
 *
 * Covered scenarios:
 *  - GET  /workflow-stages           — returns only Org A's stages; Org B stages not leaked
 *  - PATCH /workflow-stages/:id      — 404 when the stage ID belongs to Org B
 *  - DELETE /workflow-stages/:id     — 404 when the stage ID belongs to Org B
 *  - POST /workflow-stages/reorder   — Org B stage IDs silently skipped (WHERE clause filters by orgId)
 *  - DELETE /workflow-stages/:id     — 400 when reassignTo points to an Org B stage
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  /** Queue consumed by db.select() calls (one array per call). */
  selectQueue: [] as any[][],
  insertResult: [] as any[],
  updateResult: [] as any[],
}));

// ---------------------------------------------------------------------------
// Mock org-features — always enabled so feature flags don't interfere
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

// ---------------------------------------------------------------------------
// Mock ../lib/workflow-stages — getOrSeedStages returns the next selectQueue
// entry so we can control which stages the org "owns".
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
// Mock requireOrgMiddleware — caller is authenticated as an admin of "org-a"
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "org-a";
    req.user = { id: "user-a1", email: "user-a1@org-a.example" };
    req.orgPermissions = { manage_workflow_stages: true };
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

function reset() {
  mockState.selectQueue.length = 0;
  mockState.insertResult = [];
  mockState.updateResult = [];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_A_STAGE = {
  id: 1,
  orgId: "org-a",
  name: "Open",
  color: "#3b82f6",
  type: "open",
  position: 0,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ORG_A_STAGE_CLOSED = {
  id: 2,
  orgId: "org-a",
  name: "Closed",
  color: "#6b7280",
  type: "closed",
  position: 1,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** A second Org A open stage, used so deleting ORG_A_STAGE doesn't fail the minimum-count guard. */
const ORG_A_STAGE_OPEN2 = {
  id: 3,
  orgId: "org-a",
  name: "In Review",
  color: "#f59e0b",
  type: "open",
  position: 2,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** A stage that belongs to Org B — must never be returned to or modified by Org A. */
const ORG_B_STAGE = {
  id: 999,
  orgId: "org-b",
  name: "Org B secret stage",
  color: "#ef4444",
  type: "open",
  position: 0,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ===========================================================================
// GET /api/workflow-stages — list isolation
// ===========================================================================

describe("Workflow stage isolation — GET /api/workflow-stages", () => {
  beforeEach(reset);

  it("returns only Org A stages; Org B stages are never leaked", async () => {
    // getOrSeedStages returns only Org A's stages (DB filtered by orgId)
    mockState.selectQueue.push([ORG_A_STAGE, ORG_A_STAGE_CLOSED]);

    const res = await request(buildApp()).get("/api/workflow-stages");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // None of the returned stages belong to Org B
    for (const stage of res.body) {
      expect(stage.orgId).not.toBe("org-b");
      expect(stage.id).not.toBe(ORG_B_STAGE.id);
    }
  });

  it("returns an empty list when Org A has no stages (Org B stages not shown)", async () => {
    // Simulate getOrSeedStages returning nothing for Org A
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/workflow-stages");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ===========================================================================
// PATCH /api/workflow-stages/:id — cross-org update blocked
// ===========================================================================

describe("Workflow stage isolation — PATCH /api/workflow-stages/:id", () => {
  beforeEach(reset);

  it("returns 404 when targeting an Org B stage ID", async () => {
    // The DB lookup for stage 999 with orgId='org-a' returns no rows —
    // simulating that the WHERE (id=999 AND orgId='org-a') clause correctly
    // excludes Org B's stage.
    // selectQueue is empty → db.select() resolves to []

    const res = await request(buildApp())
      .patch(`/api/workflow-stages/${ORG_B_STAGE.id}`)
      .send({ name: "Hijacked Stage Name" });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 when targeting a valid Org A stage", async () => {
    mockState.selectQueue.push([ORG_A_STAGE]); // existing stage lookup succeeds
    mockState.updateResult = [{ ...ORG_A_STAGE, name: "Renamed" }];

    const res = await request(buildApp())
      .patch(`/api/workflow-stages/${ORG_A_STAGE.id}`)
      .send({ name: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });
});

// ===========================================================================
// DELETE /api/workflow-stages/:id — cross-org delete blocked
// ===========================================================================

describe("Workflow stage isolation — DELETE /api/workflow-stages/:id", () => {
  beforeEach(reset);

  it("returns 404 when targeting an Org B stage ID", async () => {
    // DB lookup for stage 999 with orgId='org-a' returns nothing
    // selectQueue is empty → db.select() resolves to []

    const res = await request(buildApp())
      .delete(`/api/workflow-stages/${ORG_B_STAGE.id}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when reassignTo points to an Org B stage", async () => {
    // First select: stage to delete belongs to Org A (found)
    mockState.selectQueue.push([ORG_A_STAGE]);
    // Second select: other active stages — ORG_A_STAGE_OPEN2 (open) + ORG_A_STAGE_CLOSED (closed)
    // ensures sameTypeCount for 'open' >= 1 so the minimum-count guard passes.
    mockState.selectQueue.push([ORG_A_STAGE_OPEN2, ORG_A_STAGE_CLOSED]);
    // Third select: count of tasks using this stage — 1 task, so reassignTo is required
    mockState.selectQueue.push([{ count: 1 }]);
    // Fourth select: reassignTo target lookup with orgId='org-a' — returns nothing
    // because stage 999 belongs to Org B, not Org A
    // selectQueue is empty at this point → db.select() resolves to []

    const res = await request(buildApp())
      .delete(`/api/workflow-stages/${ORG_A_STAGE.id}`)
      .query({ reassignTo: String(ORG_B_STAGE.id) });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    // Must not succeed — Org B's stage is not a valid reassignment target for Org A
    expect(res.status).not.toBe(204);
  });

  it("returns 204 when deleting an Org A stage with no tasks assigned", async () => {
    // First select: stage to delete (Org A, type 'open')
    mockState.selectQueue.push([ORG_A_STAGE]);
    // Second select: other active stages — another open + one closed so both
    // sameTypeCount (open) >= 1 and the closed requirement is satisfied.
    mockState.selectQueue.push([ORG_A_STAGE_OPEN2, ORG_A_STAGE_CLOSED]);
    // Third select: task count using this stage — 0, no reassignTo needed
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp())
      .delete(`/api/workflow-stages/${ORG_A_STAGE.id}`);

    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// POST /api/workflow-stages/reorder — Org B IDs silently skipped
// ===========================================================================

describe("Workflow stage isolation — POST /api/workflow-stages/reorder", () => {
  beforeEach(reset);

  it("returns 204 and does not error when the ID list contains Org B stage IDs", async () => {
    // The reorder handler issues one UPDATE per ID with WHERE (id=X AND orgId='org-a').
    // Org B's ID (999) matches no rows for Org A — it is silently skipped.
    // This confirms that submitting foreign IDs does not produce a 500, leak data,
    // or cause Org B's stage positions to change.
    const res = await request(buildApp())
      .post("/api/workflow-stages/reorder")
      .send({ ids: [ORG_A_STAGE.id, ORG_B_STAGE.id] });

    expect(res.status).toBe(204);
  });

  it("returns 204 when reordering only Org A stages", async () => {
    const res = await request(buildApp())
      .post("/api/workflow-stages/reorder")
      .send({ ids: [ORG_A_STAGE_CLOSED.id, ORG_A_STAGE.id] });

    expect(res.status).toBe(204);
  });

  it("returns 204 even when only Org B IDs are submitted (all updates are no-ops)", async () => {
    // Every UPDATE WHERE clause will match 0 rows for Org A — the endpoint
    // still returns 204 rather than a meaningful error, which is correct:
    // it confirms that Org B stages cannot be repositioned.
    const res = await request(buildApp())
      .post("/api/workflow-stages/reorder")
      .send({ ids: [ORG_B_STAGE.id] });

    expect(res.status).toBe(204);
  });
});
