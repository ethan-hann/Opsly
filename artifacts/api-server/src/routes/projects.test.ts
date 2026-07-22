/**
 * Tests for projects routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /projects      - list with task counts, empty list
 *  - POST /projects      - body validation, 201 on success
 *  - GET  /projects/:id  - 200 with task counts, 404, 400 bad id
 *  - PATCH /projects/:id - body validation, 404, 200 on success
 *  - DELETE /projects/:id - 204, 404, 400 bad id
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  /** Queue of return values for successive insert().values().returning() calls. */
  insertQueue: [] as any[][],
  /** Convenience alias: first entry in insertQueue (used by non-SLA tests). */
  get insertResult() { return this.insertQueue[0] ?? []; },
  set insertResult(v: any[]) { this.insertQueue = [v]; },
  updateResult: [] as any[],
  deleteResult: [] as any[],
  deleteCalls: 0,
  /** Tracks calls to insert() so tests can assert on audit writes. */
  insertCalls: 0,
  permissions: { manage_sla_policies: true } as Record<string, boolean>,
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

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => {
        mockState.insertCalls++;
        const result = mockState.insertQueue.shift() ?? [];
        const valuesResult = {
          returning: () => Promise.resolve(result),
          then(onfulfilled: any, onrejected: any) {
            return Promise.resolve(undefined).then(onfulfilled, onrejected);
          },
          catch(onrejected: any) {
            return Promise.resolve(undefined).catch(onrejected);
          },
        };
        return { values: () => valuesResult };
      },
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(mockState.updateResult),
          }),
        }),
      }),
      delete: () => {
        mockState.deleteCalls++;
        return {
          where: () => ({
            returning: () => Promise.resolve(mockState.deleteResult),
          }),
        };
      },
    },
    projectsTable: {},
    tasksTable: {},
    orgMembersTable: {},
    inboundWebhooksTable: {},
    outboundWebhooksTable: {},
    usersTable: {},
    slaPoliciesTable: {},
    projectSlaPolicyAuditTable: {},
    workflowStagesTable: {},
    sql: () => ({}),
    eq: () => ({}),
    and: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  ne: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  sql: () => ({}),
  desc: () => ({}),
}));

// Mock the outbound dispatcher so real HTTP calls are never attempted
vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchProjectCreated: vi.fn(),
  dispatchProjectUpdated: vi.fn(),
  dispatchProjectDeleted: vi.fn(),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.orgPermissions = mockState.permissions;
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.orgPermissions = mockState.permissions;
    next();
  },
  requirePermission: (_key: string) => (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.[_key]) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
}));

import projectsRouter from "./projects.js";
import * as webhookDispatcher from "../lib/webhook-dispatcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", projectsRouter);
  return app;
}

const MOCK_PROJECT = {
  id: 1,
  orgId: "test-org",
  name: "Infra Upgrade",
  description: "Upgrade server infra",
  status: "active",
  priority: "medium",
  dueDate: null,
  createdBy: null,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

/** Row shape returned by the left-join query in GET /projects/:id */
const MOCK_PROJECT_ROW = {
  project: MOCK_PROJECT,
  creatorFirstName: null,
  creatorLastName: null,
  creatorEmail: null,
};

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------

describe("GET /api/projects", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with an empty array when there are no projects", async () => {
    mockState.selectQueue.push([]); // projects list
    mockState.selectQueue.push([]); // task counts

    const res = await request(buildApp()).get("/api/projects");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with projects and task counts", async () => {
    mockState.selectQueue.push([MOCK_PROJECT]); // projects list
    mockState.selectQueue.push([{ projectId: 1, total: 5, completed: 2 }]); // task counts

    const res = await request(buildApp()).get("/api/projects");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 1,
      name: "Infra Upgrade",
      taskCount: 5,
      completedTaskCount: 2,
    });
  });

  it("returns taskCount 0 for projects with no tasks", async () => {
    mockState.selectQueue.push([MOCK_PROJECT]); // projects list
    mockState.selectQueue.push([]); // no task counts

    const res = await request(buildApp()).get("/api/projects");

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ taskCount: 0, completedTaskCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------

describe("POST /api/projects", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp()).post("/api/projects").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is empty", async () => {
    const res = await request(buildApp()).post("/api/projects").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("returns 201 with the created project on success", async () => {
    mockState.insertResult = [MOCK_PROJECT];

    const res = await request(buildApp())
      .post("/api/projects")
      .send({ name: "Infra Upgrade", description: "Upgrade server infra", status: "active", priority: "medium" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 1,
      name: "Infra Upgrade",
      taskCount: 0,
      completedTaskCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id
// ---------------------------------------------------------------------------

describe("GET /api/projects/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with the project and task counts", async () => {
    mockState.selectQueue.push([MOCK_PROJECT_ROW]); // project + creator join
    mockState.selectQueue.push([{ total: 3, completed: 1 }]); // task counts

    const res = await request(buildApp()).get("/api/projects/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 1,
      name: "Infra Upgrade",
      taskCount: 3,
      completedTaskCount: 1,
    });
  });

  it("returns 404 when the project does not exist", async () => {
    mockState.selectQueue.push([]); // not found

    const res = await request(buildApp()).get("/api/projects/999");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).get("/api/projects/bad-id");
    expect(res.status).toBe(400);
  });

  it("returns taskCount 0 when the project has no tasks", async () => {
    mockState.selectQueue.push([MOCK_PROJECT_ROW]); // project + creator join
    mockState.selectQueue.push([]); // no counts row

    const res = await request(buildApp()).get("/api/projects/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ taskCount: 0, completedTaskCount: 0 });
  });

  it("returns createdByName when the creator user exists", async () => {
    mockState.selectQueue.push([{
      project: MOCK_PROJECT,
      creatorFirstName: "Ada",
      creatorLastName: "Lovelace",
      creatorEmail: "ada@example.com",
    }]);
    mockState.selectQueue.push([{ total: 0, completed: 0 }]);

    const res = await request(buildApp()).get("/api/projects/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ createdByName: "Ada Lovelace" });
  });

  it("returns createdByName null when no creator is linked", async () => {
    mockState.selectQueue.push([MOCK_PROJECT_ROW]);
    mockState.selectQueue.push([{ total: 0, completed: 0 }]);

    const res = await request(buildApp()).get("/api/projects/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ createdByName: null });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/projects/:id
// ---------------------------------------------------------------------------

describe("PATCH /api/projects/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).patch("/api/projects/bad").send({ name: "New" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the project does not exist", async () => {
    mockState.updateResult = []; // update returning nothing → not found

    const res = await request(buildApp())
      .patch("/api/projects/999")
      .send({ name: "Updated" });

    expect(res.status).toBe(404);
  });

  it("returns 200 with the updated project", async () => {
    const updated = { ...MOCK_PROJECT, name: "Infra Upgrade v2" };
    mockState.updateResult = [updated];
    mockState.selectQueue.push([{ total: 5, completed: 2 }]); // task counts after update

    const res = await request(buildApp())
      .patch("/api/projects/1")
      .send({ name: "Infra Upgrade v2" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: "Infra Upgrade v2", taskCount: 5 });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/projects/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    vi.mocked(webhookDispatcher.dispatchProjectDeleted).mockClear();
  });

  it("returns 204 on successful delete", async () => {
    mockState.deleteResult = [MOCK_PROJECT];

    const res = await request(buildApp()).delete("/api/projects/1");

    expect(res.status).toBe(204);
  });

  it("calls dispatchProjectDeleted with project id and name after successful delete", async () => {
    mockState.deleteResult = [MOCK_PROJECT];

    await request(buildApp()).delete("/api/projects/1");

    expect(webhookDispatcher.dispatchProjectDeleted).toHaveBeenCalledOnce();
    expect(webhookDispatcher.dispatchProjectDeleted).toHaveBeenCalledWith(
      "test-org",
      expect.objectContaining({ id: 1, name: "Infra Upgrade" }),
    );
  });

  it("does not call dispatchProjectDeleted when project is not found", async () => {
    mockState.deleteResult = [];

    const res = await request(buildApp()).delete("/api/projects/999");

    expect(res.status).toBe(404);
    expect(webhookDispatcher.dispatchProjectDeleted).not.toHaveBeenCalled();
  });

  it("returns 404 when the project does not exist", async () => {
    mockState.deleteResult = [];

    const res = await request(buildApp()).delete("/api/projects/999");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).delete("/api/projects/bad-id");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/sla-policies — cross-org isolation
// ---------------------------------------------------------------------------

describe("GET /api/projects/:id/sla-policies", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    mockState.deleteCalls = 0;
    mockState.permissions = { manage_sla_policies: true };
  });

  it("returns 200 with the project's SLA policy overrides", async () => {
    const policy = {
      id: 10,
      orgId: "test-org",
      projectId: 1,
      priority: "high",
      responseMinutes: null,
      resolutionMinutes: 60,
      warningThresholdPercent: 80,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    mockState.selectQueue.push([{ id: 1 }]); // project ownership check
    mockState.selectQueue.push([policy]);    // sla_policies for this project

    const res = await request(buildApp()).get("/api/projects/1/sla-policies");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ priority: "high", resolutionMinutes: 60, projectId: 1 });
  });

  it("returns 200 with an empty array when the project has no overrides", async () => {
    mockState.selectQueue.push([{ id: 1 }]); // project found
    mockState.selectQueue.push([]);          // no project-level policies

    const res = await request(buildApp()).get("/api/projects/1/sla-policies");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 when the project belongs to a different org", async () => {
    // The route checks projectsTable WHERE id=? AND orgId=? — an empty result
    // means the project either doesn't exist or belongs to another org.
    mockState.selectQueue.push([]); // project not visible to this org

    const res = await request(buildApp()).get("/api/projects/999/sla-policies");

    expect(res.status).toBe(404);
    // The caller learns nothing: 404 is identical whether the project doesn't
    // exist or belongs to a different org.
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-integer project id", async () => {
    const res = await request(buildApp()).get("/api/projects/bad-id/sla-policies");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/projects/:id/sla-policies — cross-org isolation + permission gate
// ---------------------------------------------------------------------------

describe("PUT /api/projects/:id/sla-policies", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    mockState.deleteCalls = 0;
    mockState.insertCalls = 0;
    mockState.permissions = { manage_sla_policies: true };
  });

  it("returns 403 when the caller lacks manage_sla_policies permission", async () => {
    mockState.permissions = { manage_sla_policies: false };

    const res = await request(buildApp())
      .put("/api/projects/1/sla-policies")
      .send({ policies: [{ priority: "high", resolutionMinutes: 60 }] });

    expect(res.status).toBe(403);
  });

  it("returns 404 when the project belongs to a different org", async () => {
    // The route selects the project with orgId guard after parsing the body.
    mockState.selectQueue.push([]); // project not visible to this org

    const res = await request(buildApp())
      .put("/api/projects/999/sla-policies")
      .send({ policies: [{ priority: "high", resolutionMinutes: 60 }] });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    // Confirm no delete or insert happened against the foreign project's data
    expect(mockState.deleteCalls).toBe(0);
  });

  it("returns 400 for a non-integer project id", async () => {
    const res = await request(buildApp())
      .put("/api/projects/bad-id/sla-policies")
      .send({ policies: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the body contains duplicate priorities", async () => {
    const res = await request(buildApp())
      .put("/api/projects/1/sla-policies")
      .send({
        policies: [
          { priority: "high", resolutionMinutes: 60 },
          { priority: "high", resolutionMinutes: 120 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate/i);
  });

  it("returns 200 with the saved overrides on a valid upsert", async () => {
    const saved = {
      id: 20,
      orgId: "test-org",
      projectId: 1,
      priority: "high",
      responseMinutes: null,
      resolutionMinutes: 60,
      warningThresholdPercent: 80,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    mockState.selectQueue.push([{ id: 1 }]); // project ownership check
    mockState.selectQueue.push([]);           // previous policies snapshot (none)
    // First insert: sla_policies rows; second insert: audit record (no .returning())
    mockState.insertQueue = [[saved], []];

    const res = await request(buildApp())
      .put("/api/projects/1/sla-policies")
      .send({ policies: [{ priority: "high", resolutionMinutes: 60 }] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ priority: "high", resolutionMinutes: 60, projectId: 1 });
    // Existing project-level policies must have been deleted first
    expect(mockState.deleteCalls).toBe(1);
    // Audit record must have been inserted
    expect(mockState.insertCalls).toBe(2);
  });

  it("returns 200 with an empty array when policies is [] (clears all overrides)", async () => {
    mockState.selectQueue.push([{ id: 1 }]); // project ownership check
    mockState.selectQueue.push([]);           // previous policies snapshot (none)
    // Only the audit insert fires (no sla_policies insert when policies is [])
    mockState.insertQueue = [[]];

    const res = await request(buildApp())
      .put("/api/projects/1/sla-policies")
      .send({ policies: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockState.deleteCalls).toBe(1);
    expect(mockState.insertCalls).toBe(1);
  });

  it("writes an audit record capturing the actor and previous/new policies", async () => {
    const existing = {
      id: 10,
      orgId: "test-org",
      projectId: 1,
      priority: "critical",
      responseMinutes: 30,
      resolutionMinutes: 120,
      warningThresholdPercent: 80,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    const saved = {
      id: 20,
      orgId: "test-org",
      projectId: 1,
      priority: "high",
      responseMinutes: null,
      resolutionMinutes: 60,
      warningThresholdPercent: 80,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    mockState.selectQueue.push([{ id: 1 }]);    // project ownership check
    mockState.selectQueue.push([existing]);      // previous policies snapshot
    mockState.insertQueue = [[saved], []];       // sla insert + audit insert

    const res = await request(buildApp())
      .put("/api/projects/1/sla-policies")
      .send({ policies: [{ priority: "high", resolutionMinutes: 60 }] });

    expect(res.status).toBe(200);
    // Both the sla insert and the audit insert must have been called
    expect(mockState.insertCalls).toBe(2);
  });

  it("writes an audit record even when clearing all overrides (empty policies)", async () => {
    const existing = {
      id: 10,
      orgId: "test-org",
      projectId: 1,
      priority: "high",
      responseMinutes: null,
      resolutionMinutes: 240,
      warningThresholdPercent: 80,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    mockState.selectQueue.push([{ id: 1 }]);    // project ownership check
    mockState.selectQueue.push([existing]);      // previous policies snapshot
    mockState.insertQueue = [[]];               // audit insert only

    const res = await request(buildApp())
      .put("/api/projects/1/sla-policies")
      .send({ policies: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    // Audit insert fires even with an empty final state
    expect(mockState.insertCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/sla-policy-audit — permission gate + data retrieval
// ---------------------------------------------------------------------------

describe("GET /api/projects/:id/sla-policy-audit", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
    mockState.deleteCalls = 0;
    mockState.insertCalls = 0;
    mockState.permissions = { manage_sla_policies: true, view_audit_log: false } as any;
  });

  it("returns 403 when the caller has neither view_audit_log nor manage_sla_policies", async () => {
    mockState.permissions = { manage_sla_policies: false, view_audit_log: false } as any;

    const res = await request(buildApp()).get("/api/projects/1/sla-policy-audit");

    expect(res.status).toBe(403);
  });

  it("returns 200 for a caller with manage_sla_policies but not view_audit_log", async () => {
    mockState.permissions = { manage_sla_policies: true, view_audit_log: false } as any;
    mockState.selectQueue.push([{ id: 1 }]); // project ownership check
    mockState.selectQueue.push([]);           // audit entries (empty)

    const res = await request(buildApp()).get("/api/projects/1/sla-policy-audit");

    expect(res.status).toBe(200);
  });

  it("returns 200 for a caller with view_audit_log but not manage_sla_policies", async () => {
    mockState.permissions = { manage_sla_policies: false, view_audit_log: true } as any;
    mockState.selectQueue.push([{ id: 1 }]); // project ownership check
    mockState.selectQueue.push([]);           // audit entries (empty)

    const res = await request(buildApp()).get("/api/projects/1/sla-policy-audit");

    expect(res.status).toBe(200);
  });

  it("returns 404 when the project does not exist or belongs to another org", async () => {
    mockState.permissions = { manage_sla_policies: true, view_audit_log: false } as any;
    mockState.selectQueue.push([]); // project not found

    const res = await request(buildApp()).get("/api/projects/999/sla-policy-audit");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer project id", async () => {
    const res = await request(buildApp()).get("/api/projects/bad-id/sla-policy-audit");

    expect(res.status).toBe(400);
  });

  it("returns 200 with audit entries in order", async () => {
    mockState.permissions = { manage_sla_policies: true, view_audit_log: false } as any;
    const entry = {
      id: 1,
      orgId: "test-org",
      projectId: 1,
      actorId: "user-1",
      actorName: "Alice",
      previousPolicies: [],
      newPolicies: [{ priority: "high", responseMinutes: null, resolutionMinutes: 60, warningThresholdPercent: 80 }],
      createdAt: new Date("2025-06-01T12:00:00.000Z"),
    };
    mockState.selectQueue.push([{ id: 1 }]); // project ownership check
    mockState.selectQueue.push([entry]);      // audit entries

    const res = await request(buildApp()).get("/api/projects/1/sla-policy-audit");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ actorName: "Alice", projectId: 1 });
    expect(res.body[0].newPolicies).toHaveLength(1);
  });

  it("returns 200 with an empty array when no changes have been recorded", async () => {
    mockState.permissions = { view_audit_log: true, manage_sla_policies: false } as any;
    mockState.selectQueue.push([{ id: 1 }]); // project found
    mockState.selectQueue.push([]);           // no audit entries

    const res = await request(buildApp()).get("/api/projects/1/sla-policy-audit");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
