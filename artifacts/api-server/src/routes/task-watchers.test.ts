/**
 * Tests confirming the watch/unwatch/watchers endpoints enforce org isolation.
 *
 * Each route does a task lookup scoped to the caller's org before acting:
 *
 *   SELECT id FROM tasks WHERE id = :id AND orgId = :orgId
 *
 * When the task belongs to a different org the query returns no rows, so the
 * handler returns 404 — the caller learns nothing about the other org's task.
 *
 * Covered:
 *  - GET    /api/tasks/:id/watchers — 404 for cross-org task, 200 for own-org task
 *  - POST   /api/tasks/:id/watch    — 404 for cross-org task, 200 for own-org task
 *  - DELETE /api/tasks/:id/watch    — 404 for cross-org task, 200 for own-org task
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertCalls: [] as any[],
  deleteCallCount: 0,
  orgId: "org-a",
  /** Controls what onConflictDoNothing().returning() resolves to.
   *  Non-empty → new row inserted; empty → already existed (idempotent). */
  onConflictReturning: [] as any[],
  /** Controls what delete().where().returning() resolves to.
   *  Non-empty → row deleted; empty → was not watching (idempotent). */
  deleteReturning: [] as any[],
}));

// ---------------------------------------------------------------------------
// Captured dispatch calls
// ---------------------------------------------------------------------------
const mockDispatch = vi.hoisted(() => ({
  watcherAdded: vi.fn(),
  watcherRemoved: vi.fn(),
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

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: (...args: any[]) => {
          mockState.insertCalls.push(args[0]);
          return {
            returning: () => Promise.resolve([]),
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve(mockState.onConflictReturning),
            }),
          };
        },
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      }),
      delete: () => ({
        where: () => ({
          returning: () => {
            mockState.deleteCallCount++;
            return Promise.resolve(mockState.deleteReturning);
          },
        }),
      }),
    },
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    orgMembersTable: {},
    usersTable: {},
    inboundWebhooksTable: {},
    outboundWebhooksTable: {},
    customFieldDefinitionsTable: {},
    workflowStagesTable: {},
    taskEventsTable: {},
    slaPoliciesTable: {},
    taskWatchersTable: {},
    sql: () => ({}),
    eq: () => ({}),
    and: () => ({}),
    lt: () => ({}),
    isNull: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  ne: () => ({}),
  isNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  inArray: () => ({}),
  sql: () => ({}),
  getTableColumns: (t: any) => t,
}));

vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCreated: () => {},
  dispatchTaskUpdated: () => {},
  dispatchTaskCommented: () => {},
  dispatchNoteCreated: () => {},
  dispatchNoteUpdated: () => {},
  dispatchNoteDeleted: () => {},
  dispatchTaskSlaBreached: () => {},
  dispatchProjectCreated: () => {},
  dispatchProjectUpdated: () => {},
  dispatchProjectDeleted: () => {},
  dispatchTaskAssigned: () => {},
  dispatchTaskStatusChanged: () => {},
  dispatchTaskDeleted: () => {},
  dispatchWatcherAdded: mockDispatch.watcherAdded,
  dispatchWatcherRemoved: mockDispatch.watcherRemoved,
}));

vi.mock("../lib/resolve-custom-fields", () => ({
  resolveCustomFieldNames: async () => ({}),
}));

vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

vi.mock("../lib/sla", () => ({
  detectAndMarkSlaBreaches: async () => [],
  detectAndMarkSlaWarnings: async () => [],
}));

vi.mock("../lib/notifications", () => ({
  notifyTaskAssigned: async () => {},
  notifyTaskUpdated: async () => {},
}));

// ---------------------------------------------------------------------------
// Mock @workspace/api-zod — passthrough schemas for watch-related types
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => {
  const p = { parse: (x: any) => x, safeParse: (x: any) => ({ success: true, data: x }) };
  return {
    CreateTaskBody: p, UpdateTaskBody: p, GetTaskParams: p, UpdateTaskParams: p,
    DeleteTaskParams: p, ListTasksQueryParams: p, ListTasksResponse: p,
    CreateTaskResponse: p, GetTaskResponse: p, UpdateTaskResponse: p,
    GetOverdueTasksResponse: p, ListTaskEventsParams: p, ListTaskEventsResponse: p,
    BulkUpdateTasksBody: p, BulkUpdateTasksResponse: p, BulkDeleteTasksBody: p,
    BulkDeleteTasksResponse: p, WatchingFilterParam: p,
    WatchTaskParams: p, UnwatchTaskParams: p,
    GetTaskWatchersParams: p, GetTaskWatchersResponse: p,
    WatchTaskResponse: p, UnwatchTaskResponse: p,
  };
});

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = mockState.orgId;
    req.user = { id: "user-1", email: "user@example.com" };
    req.orgPermissions = {
      view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
      delete_tasks: true, manage_projects: true, manage_org_settings: true,
      manage_members: true, manage_webhooks: true, manage_api_keys: true,
      manage_custom_fields: true, manage_workflow_stages: true,
      manage_sla_policies: true, manage_task_templates: true,
      manage_saved_views: true, view_audit_log: true,
    };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = mockState.orgId;
    req.user = { id: "user-1", email: "user@example.com" };
    req.orgPermissions = {
      view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
      delete_tasks: true, manage_projects: true, manage_org_settings: true,
      manage_members: true, manage_webhooks: true, manage_api_keys: true,
      manage_custom_fields: true, manage_workflow_stages: true,
      manage_sla_policies: true, manage_task_templates: true,
      manage_saved_views: true, view_audit_log: true,
    };
    next();
  },
}));

import tasksRouter from "./tasks.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", tasksRouter);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/watchers
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/watchers — org isolation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.deleteCallCount = 0;
    mockState.orgId = "org-a";
  });

  it("returns 404 when the task belongs to a different org", async () => {
    // Task exists in org-b; the WHERE orgId='org-a' filter returns no rows.
    mockState.selectQueue.push([]); // task lookup → not found for org-a

    const res = await request(buildApp()).get("/api/tasks/99/watchers");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 with watcher data when the task belongs to the caller's org", async () => {
    mockState.selectQueue.push([{ id: 1 }]); // task belongs to org-a ✓
    mockState.selectQueue.push([]);           // watchers join — empty list

    const res = await request(buildApp()).get("/api/tasks/1/watchers");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 0, isWatching: false });
  });

  it("does not query the watchers table when the task is not found", async () => {
    // Only one selectQueue entry — if the route proceeded past the 404 it would
    // consume a second slot and throw, causing the test to fail.
    mockState.selectQueue.push([]); // task lookup → not found

    const res = await request(buildApp()).get("/api/tasks/99/watchers");

    expect(res.status).toBe(404);
    // selectQueue fully consumed — no extra DB calls made
    expect(mockState.selectQueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/watch
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/watch — org isolation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.deleteCallCount = 0;
    mockState.orgId = "org-a";
  });

  it("returns 404 when the task belongs to a different org", async () => {
    // Task 99 exists in org-b; the org-scoped SELECT returns nothing for org-a.
    mockState.selectQueue.push([]); // task lookup → not found for org-a

    const res = await request(buildApp()).post("/api/tasks/99/watch");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("does not insert a watcher row when the task is not found", async () => {
    mockState.selectQueue.push([]); // task not found → 404 short-circuits

    await request(buildApp()).post("/api/tasks/99/watch");

    // upsertWatcher must never be reached
    expect(mockState.insertCalls).toHaveLength(0);
  });

  it("returns 200 and inserts a watcher row when the task belongs to the caller's org", async () => {
    mockState.selectQueue.push([{ id: 1 }]); // task belongs to org-a ✓

    const res = await request(buildApp()).post("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ watching: true });
    expect(mockState.insertCalls).toHaveLength(1);
    expect(mockState.insertCalls[0]).toMatchObject({
      taskId: 1,
      userId: "user-1",
      orgId: "org-a",
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id/watch
// ---------------------------------------------------------------------------

describe("DELETE /api/tasks/:id/watch — org isolation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.deleteCallCount = 0;
    mockState.orgId = "org-a";
  });

  it("returns 404 when the task belongs to a different org", async () => {
    // Task 99 exists in org-b; org-a caller gets 404 — no information leak.
    mockState.selectQueue.push([]); // task lookup → not found for org-a

    const res = await request(buildApp()).delete("/api/tasks/99/watch");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("does not delete any watcher row when the task is not found", async () => {
    mockState.selectQueue.push([]); // not found → 404 short-circuits

    await request(buildApp()).delete("/api/tasks/99/watch");

    // db.delete must never be reached
    expect(mockState.deleteCallCount).toBe(0);
  });

  it("returns 200 and deletes the watcher row when the task belongs to the caller's org", async () => {
    mockState.selectQueue.push([{ id: 1 }]); // task belongs to org-a ✓

    const res = await request(buildApp()).delete("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ watching: false });
    expect(mockState.deleteCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/watch — webhook dispatch
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/watch — webhook dispatch", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.deleteCallCount = 0;
    mockState.onConflictReturning = [];
    mockState.deleteReturning = [];
    mockState.orgId = "org-a";
    mockDispatch.watcherAdded.mockClear();
    mockDispatch.watcherRemoved.mockClear();
  });

  it("fires dispatchWatcherAdded when a new watcher row is inserted", async () => {
    mockState.selectQueue.push([{ id: 1, orgTaskNumber: 42, projectId: 7 }]); // task found ✓
    mockState.onConflictReturning = [{ taskId: 1 }]; // new row inserted

    const res = await request(buildApp()).post("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(mockDispatch.watcherAdded).toHaveBeenCalledTimes(1);
    expect(mockDispatch.watcherAdded).toHaveBeenCalledWith(
      "org-a",
      7,
      expect.objectContaining({ id: 1, orgTaskNumber: 42 }),
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("does not fire dispatchWatcherAdded when the user is already watching (idempotent)", async () => {
    mockState.selectQueue.push([{ id: 1, orgTaskNumber: 42, projectId: 7 }]); // task found ✓
    mockState.onConflictReturning = []; // conflict — already watching

    const res = await request(buildApp()).post("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(mockDispatch.watcherAdded).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id/watch — webhook dispatch
// ---------------------------------------------------------------------------

describe("DELETE /api/tasks/:id/watch — webhook dispatch", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertCalls.length = 0;
    mockState.deleteCallCount = 0;
    mockState.onConflictReturning = [];
    mockState.deleteReturning = [];
    mockState.orgId = "org-a";
    mockDispatch.watcherAdded.mockClear();
    mockDispatch.watcherRemoved.mockClear();
  });

  it("fires dispatchWatcherRemoved when the watcher row is deleted", async () => {
    mockState.selectQueue.push([{ id: 1, orgTaskNumber: 42, projectId: 7 }]); // task found ✓
    mockState.deleteReturning = [{ taskId: 1 }]; // row existed and was deleted

    const res = await request(buildApp()).delete("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(mockDispatch.watcherRemoved).toHaveBeenCalledTimes(1);
    expect(mockDispatch.watcherRemoved).toHaveBeenCalledWith(
      "org-a",
      7,
      expect.objectContaining({ id: 1, orgTaskNumber: 42 }),
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("does not fire dispatchWatcherRemoved when the user was not watching (idempotent)", async () => {
    mockState.selectQueue.push([{ id: 1, orgTaskNumber: 42, projectId: 7 }]); // task found ✓
    mockState.deleteReturning = []; // no row to delete — wasn't watching

    const res = await request(buildApp()).delete("/api/tasks/1/watch");

    expect(res.status).toBe(200);
    expect(mockDispatch.watcherRemoved).not.toHaveBeenCalled();
  });
});
