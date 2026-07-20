/**
 * Tests for dashboard routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET /dashboard/summary  - full stats object, zero-state fallback
 *  - GET /dashboard/activity - merged + sorted activity feed, empty state
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
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
    },
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    workflowStagesTable: {},
    sql: () => ({}),
    eq: () => ({}),
    and: () => ({}),
    lt: () => ({}),
    isNull: () => ({}),
    asc: () => ({}),
    desc: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  lt: () => ({}),
  sql: () => ({}),
  isNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    next();
  },
}));

import dashboardRouter from "./dashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", dashboardRouter);
  return app;
}

// summary makes 5 selects: taskTypeAgg, stageBreakdown, taskStats (priority), overdueResult, projectStats
function pushSummarySelects(
  taskTypeAgg: any[] = [],
  stageBreakdown: any[] = [],
  taskStats = { total: 0, low: 0, medium: 0, high: 0, critical: 0 },
  overdueCount = 0,
  projectStats = { total: 0, active: 0 },
) {
  mockState.selectQueue.push(taskTypeAgg);
  mockState.selectQueue.push(stageBreakdown);
  mockState.selectQueue.push([taskStats]);
  mockState.selectQueue.push([{ count: overdueCount }]);
  mockState.selectQueue.push([projectStats]);
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/summary
// ---------------------------------------------------------------------------

describe("GET /api/dashboard/summary", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 200 with all-zero counts when there is no data", async () => {
    pushSummarySelects();

    const res = await request(buildApp()).get("/api/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalTasks: 0,
      totalProjects: 0,
      overdueCount: 0,
      activeProjects: 0,
      tasksByStageType: { open: 0, closed: 0 },
      tasksByPriority: { low: 0, medium: 0, high: 0, critical: 0 },
    });
  });

  it("returns 200 with populated counts", async () => {
    pushSummarySelects(
      [{ type: "open", count: 9 }, { type: "closed", count: 3 }], // taskTypeAgg
      [], // stageBreakdown
      { total: 12, low: 1, medium: 5, high: 4, critical: 2 },     // taskStats
      3,                                                           // overdueCount
      { total: 4, active: 2 },                                     // projectStats
    );

    const res = await request(buildApp()).get("/api/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalTasks: 12,
      totalProjects: 4,
      overdueCount: 3,
      activeProjects: 2,
      tasksByStageType: { open: 9, closed: 3 },
      tasksByPriority: { low: 1, medium: 5, high: 4, critical: 2 },
    });
  });

  it("falls back to zero when DB rows are missing", async () => {
    // Push 5 empty arrays — the handler uses ?? 0 fallbacks for all fields
    mockState.selectQueue.push([]); // taskTypeAgg
    mockState.selectQueue.push([]); // stageBreakdown
    mockState.selectQueue.push([]); // taskStats
    mockState.selectQueue.push([]); // overdueResult
    mockState.selectQueue.push([]); // projectStats

    const res = await request(buildApp()).get("/api/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body.totalTasks).toBe(0);
    expect(res.body.overdueCount).toBe(0);
    expect(res.body.totalProjects).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/activity
// ---------------------------------------------------------------------------

describe("GET /api/dashboard/activity", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  const RECENT_TASK = {
    id: 1,
    title: "Deploy v2",
    createdAt: new Date("2024-06-01T10:00:00.000Z"),
  };

  const RECENT_COMMENT = {
    id: 10,
    content: "Looks good",
    taskId: 1,
    taskTitle: "Deploy v2",
    createdAt: new Date("2024-06-01T11:00:00.000Z"),
  };

  const RECENT_PROJECT = {
    id: 5,
    name: "Infra Upgrade",
    createdAt: new Date("2024-06-01T09:00:00.000Z"),
  };

  // activity makes 3 selects: recentTasks, recentComments, recentProjects
  function pushActivitySelects(tasks: any[] = [], comments: any[] = [], projects: any[] = []) {
    mockState.selectQueue.push(tasks);
    mockState.selectQueue.push(comments);
    mockState.selectQueue.push(projects);
  }

  it("returns 200 with an empty array when there is no data", async () => {
    pushActivitySelects();

    const res = await request(buildApp()).get("/api/dashboard/activity");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with activity items sorted by createdAt descending", async () => {
    pushActivitySelects([RECENT_TASK], [RECENT_COMMENT], [RECENT_PROJECT]);

    const res = await request(buildApp()).get("/api/dashboard/activity");

    expect(res.status).toBe(200);
    // comment is newest, then task, then project
    expect(res.body[0]).toMatchObject({ type: "comment_added" });
    expect(res.body[1]).toMatchObject({ type: "task_created" });
    expect(res.body[2]).toMatchObject({ type: "project_created" });
  });

  it("includes task_created items with correct shape", async () => {
    pushActivitySelects([RECENT_TASK], [], []);

    const res = await request(buildApp()).get("/api/dashboard/activity");

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      type: "task_created",
      title: "Task created: Deploy v2",
      entityId: 1,
      entityType: "task",
    });
  });

  it("includes comment_added items with correct shape", async () => {
    pushActivitySelects([], [RECENT_COMMENT], []);

    const res = await request(buildApp()).get("/api/dashboard/activity");

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      type: "comment_added",
      title: 'Comment on "Deploy v2"',
      entityId: 1,
      entityType: "task",
    });
  });

  it("includes project_created items with correct shape", async () => {
    pushActivitySelects([], [], [RECENT_PROJECT]);

    const res = await request(buildApp()).get("/api/dashboard/activity");

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      type: "project_created",
      title: "Project created: Infra Upgrade",
      entityId: 5,
      entityType: "project",
    });
  });

  it("caps the combined feed at 10 items", async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      title: `Task ${i + 1}`,
      createdAt: new Date(`2024-06-0${i + 1}T10:00:00.000Z`),
    }));
    const comments = Array.from({ length: 5 }, (_, i) => ({
      id: i + 100,
      content: `Comment ${i + 1}`,
      taskId: 1,
      taskTitle: "Task 1",
      createdAt: new Date(`2024-06-0${i + 1}T11:00:00.000Z`),
    }));
    const projects = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      name: `Project ${i + 1}`,
      createdAt: new Date(`2024-06-0${i + 1}T09:00:00.000Z`),
    }));
    pushActivitySelects(tasks, comments, projects);

    const res = await request(buildApp()).get("/api/dashboard/activity");

    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });
});
