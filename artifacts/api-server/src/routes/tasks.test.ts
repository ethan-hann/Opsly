/**
 * Unit tests for assignee validation in the tasks routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests
 * run without a live database or auth session.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state — created via vi.hoisted so it is available inside the
// vi.mock factory closures (which are hoisted above regular module code).
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  /** Queue of results for sequential db.select() calls within a request. */
  selectQueue: [] as any[][],
  /** Result returned by db.insert().values().returning(). */
  insertResult: [] as any[],
  /** Result returned by db.update().set().where().returning(). */
  updateResult: [] as any[],
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// The real module throws at import time when DATABASE_URL is missing, and all
// Drizzle methods chain in ways that are database-specific. We replace the
// whole module with a simple fluent stub whose terminal methods resolve from
// mockState so each test can control what the route handler "sees".
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  /** Build a chainable object that resolves to `result` when awaited. */
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      limit: () => Promise.resolve(result),
      orderBy: () => Promise.resolve(result),
      // Make the chain itself thenable so `await db.select(...).from(...).where(...)`
      // works without an explicit terminal call.
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
    },
    // Table references — only used as identifiers passed into the mock chain
    // methods, which ignore their arguments, so empty objects are fine.
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    orgMembersTable: {},
    usersTable: {},
    // Re-export drizzle helpers referenced by routes/tasks.ts at the top level
    sql: () => ({}),
    eq: () => ({}),
    and: () => ({}),
    lt: () => ({}),
  };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm helpers (eq, and, sql, lt) — the real implementations
// build SQL AST nodes that would be passed to a real DB driver. Our mock db
// chain ignores all arguments, so the helpers just need to be callable.
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  lt: () => ({}),
  sql: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware so routes don't need a real user session or DB.
// requireOrg simply injects req.orgId and continues the chain.
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    next();
  },
}));

// Import after mocks are registered.
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

const VALID_TASK_BODY = {
  title: "Fix the server",
  status: "todo",
  priority: "medium",
  category: "incident",
};

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

// ---------------------------------------------------------------------------
// POST /api/tasks — assignee validation
// ---------------------------------------------------------------------------

describe("POST /api/tasks — assignee validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [MOCK_TASK];
    mockState.updateResult = [];
  });

  it("accepts a task with no assignee (unassigned)", async () => {
    // assigneeBelongsToOrg short-circuits for null/undefined — no select call.
    // buildTaskWithProject: MOCK_TASK.projectId is null so project lookup is
    // skipped; only the comment-count select fires.
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send(VALID_TASK_BODY);

    expect(res.status).toBe(201);
  });

  it("accepts a task whose assignee is an org member", async () => {
    // assigneeBelongsToOrg → member row found
    mockState.selectQueue.push([{ userId: "user-1" }]);
    // buildTaskWithProject: no project (null projectId), comment count only
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, assignee: "member@example.com" });

    expect(res.status).toBe(201);
  });

  it("rejects a task whose assignee is not an org member", async () => {
    // assigneeBelongsToOrg → no row found
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ ...VALID_TASK_BODY, assignee: "outsider@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/member/i),
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id — assignee validation
// ---------------------------------------------------------------------------

describe("PATCH /api/tasks/:id — assignee validation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.updateResult = [MOCK_TASK];
  });

  it("accepts a patch with no assignee field", async () => {
    // No assignee in body → assigneeBelongsToOrg not invoked.
    // buildTaskWithProject: MOCK_TASK.projectId is null so only comment count fires.
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
  });

  it("accepts a patch whose assignee is an org member", async () => {
    // assigneeBelongsToOrg → member row found
    mockState.selectQueue.push([{ userId: "user-1" }]);
    // buildTaskWithProject: no project (null projectId), comment count only
    mockState.selectQueue.push([{ count: 0 }]);

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ assignee: "member@example.com" });

    expect(res.status).toBe(200);
  });

  it("rejects a patch whose assignee is not an org member", async () => {
    // assigneeBelongsToOrg → no row found
    mockState.selectQueue.push([]);

    const res = await request(buildApp())
      .patch("/api/tasks/1")
      .send({ assignee: "outsider@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/member/i),
    });
  });
});
