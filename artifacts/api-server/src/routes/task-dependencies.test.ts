/**
 * Unit tests for task-dependencies routes.
 *
 * Covers:
 *  - GET /task-dependencies — task_trees disabled returns 403
 *  - GET /task-dependencies — missing projectId returns 400
 *  - POST /task-dependencies — link_tasks absence returns 403
 *  - POST /task-dependencies — task_trees disabled returns 403
 *  - POST /task-dependencies — self-link returns 400
 *  - DELETE /task-dependencies/:id — missing link_tasks returns 403
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Shared mock state — must be hoisted so mocks can reference it
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  hasLinkTasks: true,
  taskTreesEnabled: true,
  orgId: "org-1",
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

  const dbMock: Record<string, unknown> = {
    select: () => makeChain([]),
    insert: () => ({
      values: () => ({
        returning: () =>
          Promise.resolve([{ id: 1, orgId: "org-1", taskId: 1, dependsOnTaskId: 2 }]),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([{ id: 1 }]),
      }),
    }),
    execute: () => Promise.resolve({ rows: [] }),
    transaction: async (fn: (db: unknown) => unknown) => fn(dbMock),
  };

  return {
    db: dbMock,
    taskDependenciesTable: {},
    tasksTable: {},
    organizationsTable: {},
    projectsTable: {},
    workflowStagesTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  ne: () => ({}),
  inArray: () => ({}),
  sql: Object.assign(
    (_s: TemplateStringsArray, ..._v: unknown[]) => ({ raw: "sql" }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}));

// ---------------------------------------------------------------------------
// Mock org-features — controls task_trees enabled/disabled per test
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features.js", () => ({
  requireOrgFeature: (_featureKey: string) => (req: Request, res: Response, next: NextFunction) => {
    if (!mockState.taskTreesEnabled) {
      res.status(403).json({ error: "Feature disabled" });
      return;
    }
    next();
  },
}));

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware — supplies orgId + permission checks
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware.js", () => ({
  requireOrgOrApiKey: (req: Request, _res: Response, next: NextFunction) => {
    req.orgId = mockState.orgId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).userId = "user-1";
    next();
  },
  hasPermission: (_req: Request, key: string) => {
    if (key === "link_tasks") return mockState.hasLinkTasks;
    return true;
  },
  requirePermission: (key: string) => (_req: Request, res: Response, next: NextFunction) => {
    if (key === "link_tasks" && !mockState.hasLinkTasks) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
  requireScope: (_scope: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireOrg: (req: Request, _res: Response, next: NextFunction) => {
    req.orgId = mockState.orgId;
    next();
  },
}));

// ---------------------------------------------------------------------------
// Build app — dynamic import so mocks take effect first
// ---------------------------------------------------------------------------
let cachedRouter: express.Router | null = null;

async function buildApp() {
  if (!cachedRouter) {
    const mod = await import("./task-dependencies.js");
    cachedRouter = mod.default as express.Router;
  }
  const app = express();
  app.use(express.json());
  app.use("/api", cachedRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/task-dependencies", () => {
  beforeEach(() => {
    mockState.hasLinkTasks = true;
    mockState.taskTreesEnabled = true;
  });

  it("returns 403 when task_trees feature is disabled", async () => {
    mockState.taskTreesEnabled = false;
    const app = await buildApp();
    const res = await request(app).get("/api/task-dependencies?projectId=10");
    expect(res.status).toBe(403);
  });

  it("returns 400 when projectId is missing", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/task-dependencies");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/task-dependencies", () => {
  beforeEach(() => {
    mockState.hasLinkTasks = true;
    mockState.taskTreesEnabled = true;
  });

  it("returns 403 when user lacks link_tasks permission", async () => {
    mockState.hasLinkTasks = false;
    const app = await buildApp();
    const res = await request(app)
      .post("/api/task-dependencies")
      .send({ taskId: 1, dependsOnTaskId: 2 });
    expect(res.status).toBe(403);
  });

  it("returns 403 when task_trees feature is disabled", async () => {
    mockState.taskTreesEnabled = false;
    const app = await buildApp();
    const res = await request(app)
      .post("/api/task-dependencies")
      .send({ taskId: 1, dependsOnTaskId: 2 });
    expect(res.status).toBe(403);
  });

  it("returns 400 when taskId === dependsOnTaskId (self-link)", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/task-dependencies")
      .send({ taskId: 5, dependsOnTaskId: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/itself|same task/i);
  });
});

describe("DELETE /api/task-dependencies/:id", () => {
  beforeEach(() => {
    mockState.hasLinkTasks = true;
    mockState.taskTreesEnabled = true;
  });

  it("returns 403 when user lacks link_tasks permission", async () => {
    mockState.hasLinkTasks = false;
    const app = await buildApp();
    const res = await request(app).delete("/api/task-dependencies/1");
    expect(res.status).toBe(403);
  });
});
