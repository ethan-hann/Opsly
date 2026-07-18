/**
 * Tests for tasks routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /tasks/overdue — list enriched overdue tasks
 *  - GET  /tasks         — list all tasks, filter by projectId/status/priority/category
 *  - GET  /tasks/:id     — 200 with enriched task, 404, 400 bad id
 *  - POST /tasks         — body validation, projectId validation, assignee validation, 201
 *  - PATCH /tasks/:id    — params/body validation, projectId validation, assignee validation, 404, 200
 *  - DELETE /tasks/:id   — 204, 404, 400 bad id
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
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    orgMembersTable: {},
    usersTable: {},
    sql: () => ({}),
    eq: () => ({}),
    and: () => ({}),
    lt: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  lt: () => ({}),
  or: () => ({}),
  sql: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: "user-owner" };
    next();
  },
}));

import tasksRouter from "./tasks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", tasksRouter);
  return app;
}

const MOCK_TASK = {
  id: 1,
  orgId: "test-org",
  title: "Fix the server",
  status: "todo",
  priority: "medium",
  category: "incident",
  projectId: null,
  description: null,
  assignee: null,
  dueDate: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const VALID_TASK_BODY = {
  title: "Fix the server",
  status: "todo",
  priority: "medium",
  category: "incident",
};

// buildTaskWithProject for a task with no projectId makes 1 select (comment count).
function pushEnrichedTask(task = MOCK_TASK) {
  // The route first selects the task, then buildTaskWithProject makes 1 comment-count select.
  mockState.selectQueue.push([task]);
  mockState.selectQueue.push([{ count: 0 }]);
}

// ---------------------------------------------------------------------------
// GET /api/tasks/overdue
// ---------------------------------------------------------------------------

describe("GET /api/tasks/overdue", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with an empty array when there are no overdue tasks", async () => {
    mockState.selectQueue.push([]); // tasks query returns nothing

    const res = await request(buildApp()).get("/api/tasks/overdue");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with enriched overdue tasks", async () => {
    // overdue query returns 1 task; buildTaskWithProject adds comment count select
    mockState.selectQueue.push([MOCK_TASK]); // overdue tasks list
    mockState.selectQueue.push([{ count: 2 }]); // comment count for the task

    const res = await request(buildApp()).get("/api/tasks/overdue");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, title: "Fix the server", commentCount: 2 });
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks
// ---------------------------------------------------------------------------

describe("GET /api/tasks", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with an empty array when there are no tasks", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with enriched tasks", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task list
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, title: "Fix the server", commentCount: 0 });
  });

  it("accepts projectId, status, priority, and category query filters", async () => {
    mockState.selectQueue.push([MOCK_TASK]);
    mockState.selectQueue.push([{ count: 1 }]);

    const res = await request(buildApp()).get(
      "/api/tasks?projectId=5&status=todo&priority=medium&category=incident",
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("passes unrecognised status strings through (schema uses coerce.string, not enum)", async () => {
    // ListTasksQueryParams.status is zod.coerce.string(), not an enum — unknown
    // values are forwarded to the DB layer rather than rejected at the route level.
    mockState.selectQueue.push([]); // tasks query returns empty list
    const res = await request(buildApp()).get("/api/tasks?status=not_a_status");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/:id
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 200 with the enriched task when found", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task lookup
    mockState.selectQueue.push([{ count: 3 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: "Fix the server", commentCount: 3 });
  });

  it("returns 404 when the task does not exist", async () => {
    mockState.selectQueue.push([]); // task not found

    const res = await request(buildApp()).get("/api/tasks/999");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).get("/api/tasks/not-a-number");
    expect(res.status).toBe(400);
  });

  it("enriches the task with project name when projectId is set", async () => {
    const taskWithProject = { ...MOCK_TASK, projectId: 5 };
    mockState.selectQueue.push([taskWithProject]); // task lookup
    mockState.selectQueue.push([{ name: "Infra Upgrade" }]); // project lookup
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp()).get("/api/tasks/1");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectId: 5, projectName: "Infra Upgrade" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks — body validation
// ---------------------------------------------------------------------------

describe("POST /api/tasks — body validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ status: "todo", priority: "low", category: "incident" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when projectId is not in the org", async () => {
    mockState.selectQueue.push([]); // projectBelongsToOrg → not found

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, projectId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/projectId/i) });
  });

  it("returns 201 with the created task on success", async () => {
    mockState.insertResult = [MOCK_TASK];
    mockState.selectQueue.push([{ count: 0 }]); // buildTaskWithProject comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send(VALID_TASK_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, title: "Fix the server" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks — assignee validation (existing coverage, kept)
// ---------------------------------------------------------------------------

describe("POST /api/tasks — assignee validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [MOCK_TASK];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("accepts a task with no assignee (unassigned)", async () => {
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).post("/api/tasks").send(VALID_TASK_BODY);

    expect(res.status).toBe(201);
  });

  it("accepts a task whose assignee is an org member", async () => {
    mockState.selectQueue.push([{ userId: "user-1" }]); // assignee in org
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, assignee: "member@example.com" });

    expect(res.status).toBe(201);
  });

  it("rejects a task whose assignee is not an org member", async () => {
    mockState.selectQueue.push([]); // assignee not in org

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, assignee: "outsider@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/member/i) });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id — validation + business logic
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id — validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
    mockState.deleteResult = [];
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).patch("/api/tasks/bad-id").send({ status: "done" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the task does not exist", async () => {
    mockState.updateResult = []; // update returns nothing → task not found

    const res = await request(buildApp())
      .patch("/api/tasks/999")
      .send({ status: "done" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when projectId is not in the org", async () => {
    mockState.selectQueue.push([]); // projectBelongsToOrg → not found

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ projectId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/projectId/i) });
  });

  it("returns 200 on a successful status update", async () => {
    const updated = { ...MOCK_TASK, status: "in_progress" };
    mockState.updateResult = [updated];
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, status: "in_progress" });
  });

  it("returns 200 when assigning a valid projectId", async () => {
    const updated = { ...MOCK_TASK, projectId: 5 };
    mockState.selectQueue.push([{ id: 5 }]); // projectBelongsToOrg → found
    mockState.updateResult = [updated];
    mockState.selectQueue.push([{ name: "Infra Upgrade" }]); // project name
    mockState.selectQueue.push([{ count: 0 }]); // comment count

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ projectId: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectId: 5 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id — assignee validation (existing coverage, kept)
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id — assignee validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
    mockState.deleteResult = [];
  });

  it("accepts a patch with no assignee field", async () => {
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp()).patch("/api/tasks/1").send({ status: "in_progress" });

    expect(res.status).toBe(200);
  });

  it("accepts a patch whose assignee is an org member", async () => {
    mockState.selectQueue.push([{ userId: "user-1" }]);
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ assignee: "member@example.com" });

    expect(res.status).toBe(200);
  });

  it("rejects a patch whose assignee is not an org member", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ assignee: "outsider@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/member/i) });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/tasks/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [];
    mockState.deleteResult = [];
  });

  it("returns 204 on successful delete", async () => {
    mockState.deleteResult = [MOCK_TASK];

    const res = await request(buildApp()).delete("/api/tasks/1");

    expect(res.status).toBe(204);
  });

  it("returns 404 when the task does not exist", async () => {
    mockState.deleteResult = []; // delete returning nothing → not found

    const res = await request(buildApp()).delete("/api/tasks/999");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer id", async () => {
    const res = await request(buildApp()).delete("/api/tasks/bad-id");
    expect(res.status).toBe(400);
  });
});
