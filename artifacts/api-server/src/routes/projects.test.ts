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
  insertResult: [] as any[],
  updateResult: [] as any[],
  deleteResult: [] as any[],
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
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockState.deleteResult),
        }),
      }),
    },
    projectsTable: {},
    tasksTable: {},
    orgMembersTable: {},
    inboundWebhooksTable: {},
    outboundWebhooksTable: {},
    usersTable: {},
    slaPoliciesTable: {},
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
  sql: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.orgPermissions = { manage_sla_policies: true };
    next();
  },
  requirePermission: (_key: string) => (req: any, _res: any, next: any) => {
    if (req.orgPermissions?.[_key] === false) {
      _res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
}));

import projectsRouter from "./projects.js";

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
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
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
    mockState.selectQueue.push([MOCK_PROJECT]); // project lookup
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
    mockState.selectQueue.push([MOCK_PROJECT]);
    mockState.selectQueue.push([]); // no counts row

    const res = await request(buildApp()).get("/api/projects/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ taskCount: 0, completedTaskCount: 0 });
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
  });

  it("returns 204 on successful delete", async () => {
    mockState.deleteResult = [MOCK_PROJECT];

    const res = await request(buildApp()).delete("/api/projects/1");

    expect(res.status).toBe(204);
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
