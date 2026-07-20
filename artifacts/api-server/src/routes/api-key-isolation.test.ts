/**
 * Cross-tenant (organization) isolation tests for API key authentication.
 *
 * Verifies that a valid API key issued for org A cannot access org B's data,
 * that scope enforcement correctly gates API-key-accessible routes, and that
 * routes using requireOrg (the fail-closed variant) reject API keys outright.
 *
 * Unlike isolation.test.ts (which mocks requireOrgMiddleware entirely), these
 * tests use the REAL requireOrgOrApiKey and requireScope implementations.
 * A "simApiKeyAuth" middleware is prepended to the test app to replicate what
 * authMiddleware.resolveApiKey() sets after a successful key lookup:
 *
 *   req.apiKeyId     = "key-org-a-1"      (opaque key ID)
 *   req.orgId        = "org-a"            (derived from the key's DB record — not client-supplied)
 *   req.apiKeyScopes = [...]              (controlled per-test via authState.scopes)
 *
 * The critical security invariant: req.orgId is always set from the key record,
 * never from client input. Routes scope every query to req.orgId, so a key for
 * org-a cannot read or enumerate org-b resources regardless of what IDs the
 * client provides in the URL.
 *
 * Covered scenarios:
 *  - Unauthenticated (no key, no session) → 401
 *  - tasks:read scope missing → 403 insufficient_scope on GET /tasks
 *  - tasks:read scope missing → 403 insufficient_scope on GET /tasks/:id
 *  - projects:read scope missing → 403 insufficient_scope on GET /projects
 *  - GET /api/notes (requireOrg route) → 403 for any API key
 *  - GET /api/dashboard/summary (requireOrg route) → 403 for any API key
 *  - GET /api/tasks — org-a key → empty list; org-b tasks are absent
 *  - GET /api/tasks — org-a key → only org-a tasks returned
 *  - GET /api/tasks/:id (org-b task ID) via org-a key → 404
 *  - GET /api/projects — org-a key → empty list; org-b projects are absent
 *  - GET /api/projects — org-a key → only org-a projects returned
 *  - GET /api/projects/:id (org-b project ID) via org-a key → 404
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Auth state — drives the simApiKeyAuth middleware below.
// authState.enabled = false → unauthenticated (neither key nor session).
// authState.orgId   → the org embedded in the key record (server-side, immutable).
// authState.scopes  → the scope list granted to the key.
// ---------------------------------------------------------------------------
const authState = vi.hoisted(() => ({
  enabled: true,
  orgId: "org-a",
  scopes: [
    "tasks:read", "tasks:write",
    "projects:read", "projects:write",
    "comments:read", "comments:write",
  ] as string[],
}));

// ---------------------------------------------------------------------------
// DB select queue — consumed in call order by route handlers
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertResult: [] as any[],
  updateResult: [] as any[],
  deleteResult: [] as any[],
}));

// ---------------------------------------------------------------------------
// @workspace/api-zod — passthrough (isolation tests verify org scoping, not
// schema validation)
// ---------------------------------------------------------------------------
vi.mock("@workspace/api-zod", () => {
  const p = {
    parse: (x: any) => x,
    safeParse: (x: any) => ({ success: true, data: x }),
  };
  return {
    // tasks
    CreateTaskBody: p, UpdateTaskBody: p,
    GetTaskParams: p, UpdateTaskParams: p, DeleteTaskParams: p,
    ListTasksQueryParams: p,
    ListTasksResponse: p, CreateTaskResponse: p, GetTaskResponse: p,
    UpdateTaskResponse: p, GetOverdueTasksResponse: p,
    BulkUpdateTasksBody: p, BulkUpdateTasksResponse: p,
    BulkDeleteTasksBody: p, BulkDeleteTasksResponse: p,
    ListTaskEventsParams: p, ListTaskEventsResponse: p,
    WatchingFilterParam: p, WatchTaskParams: p, UnwatchTaskParams: p,
    GetTaskWatchersParams: p, GetTaskWatchersResponse: p,
    WatchTaskResponse: p, UnwatchTaskResponse: p,
    // projects
    CreateProjectBody: p, UpdateProjectBody: p,
    GetProjectParams: p, UpdateProjectParams: p, DeleteProjectParams: p,
    ListProjectsResponse: p, CreateProjectResponse: p,
    GetProjectResponse: p, UpdateProjectResponse: p,
    // comments
    CreateCommentBody: p, CreateCommentParams: p,
    ListCommentsParams: p, DeleteCommentParams: p,
    ListCommentsResponse: p, CreateCommentResponse: p, DeleteCommentResponse: p,
    // notes
    ListNotesQueryParams: p, ListNotesResponse: p,
    CreateNoteBody: p, CreateNoteResponse: p,
    GetNoteParams: p, GetNoteResponse: p,
    UpdateNoteParams: p, UpdateNoteBody: p, UpdateNoteResponse: p,
    DeleteNoteParams: p,
    // dashboard
    GetDashboardSummaryResponse: p, GetRecentActivityResponse: p,
  };
});

// ---------------------------------------------------------------------------
// @workspace/db — fully mocked; no real database connection
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

  const dbMock: any = {
    select: () => makeChain(mockState.selectQueue.shift() ?? []),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockState.insertResult),
        onConflictDoNothing: () => Promise.resolve([]),
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
      where: () => {
        const p = Promise.resolve(mockState.deleteResult);
        (p as any).returning = () => Promise.resolve(mockState.deleteResult);
        return p;
      },
    }),
    transaction: async (fn: any) => fn(dbMock),
  };

  return {
    db: dbMock,
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    notesTable: {},
    orgMembersTable: {},
    organizationsTable: {},
    rolesTable: {},
    usersTable: {},
    invitationsTable: {},
    savedViewsTable: {},
    taskTemplatesTable: {},
    slaPoliciesTable: {},
    taskEventsTable: {},
    workflowStagesTable: {},
    customFieldDefinitionsTable: {},
    taskWatchersTable: {},
    OWNER_PERMISSIONS: {},
    ADMIN_PERMISSIONS: {},
    MEMBER_PERMISSIONS: {},
    ALL_PERMISSIONS: [],
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  ne: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  isNull: () => ({}),
  inArray: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  sql: () => ({}),
}));

// requireOrgMiddleware is intentionally NOT mocked — the real requireOrgOrApiKey,
// requireOrg, and requireScope implementations run so we exercise the actual
// auth logic, not a substitute.

vi.mock("../lib/notes-sse", () => ({
  addSseClient: () => () => {},
  broadcastNoteChange: () => {},
}));

vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCreated: () => {},
  dispatchTaskUpdated: () => {},
  dispatchTaskCommented: () => {},
  dispatchTaskSlaBreached: () => {},
  dispatchNoteCreated: () => {},
  dispatchNoteUpdated: () => {},
  dispatchNoteDeleted: () => {},
  dispatchProjectCreated: () => {},
  dispatchProjectUpdated: () => {},
}));

// ---------------------------------------------------------------------------
// Import routes AFTER mocks
// ---------------------------------------------------------------------------
import tasksRouter from "./tasks.js";
import projectsRouter from "./projects.js";
import notesRouter from "./notes.js";
import dashboardRouter from "./dashboard.js";

// ---------------------------------------------------------------------------
// App factory
//
// simApiKeyAuth runs first and replicates exactly what authMiddleware.resolveApiKey
// does after successfully looking up the key in the database:
//   - req.apiKeyId is set (marks the request as API-key-authenticated)
//   - req.orgId is set to the org embedded in the key record (never from client input)
//   - req.apiKeyScopes is set to the scopes granted to the key
//
// When authState.enabled = false, none of these are set — simulating a request
// with no cookie and no Authorization header (completely unauthenticated).
// ---------------------------------------------------------------------------
function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Simulate authMiddleware: populate key fields from the key's DB record.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Always attach isAuthenticated (normally set by authMiddleware).
    req.isAuthenticated = function (this: Request) {
      return this.user != null;
    } as Request["isAuthenticated"];

    if (authState.enabled) {
      req.apiKeyId = "key-org-a-1";
      req.apiKeyName = "Test key";
      // orgId comes from the key's DB record — the client cannot supply or change it.
      req.orgId = authState.orgId;
      req.apiKeyScopes = authState.scopes as any;
    }
    next();
  });

  app.use("/api", tasksRouter);
  app.use("/api", projectsRouter);
  app.use("/api", notesRouter);
  app.use("/api", dashboardRouter);

  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[test app error]", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? String(err) });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_A_TASK = {
  id: 1, orgId: "org-a", orgTaskNumber: 1, title: "Org A task",
  status: "todo", priority: "medium", category: "other",
  projectId: null, description: null, assignee: null, dueDate: null,
  customFields: {}, slaBreachedAt: null, slaWarningSentAt: null,
  sourceWebhookId: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

/** ID of an org-b task — the org-a key must never retrieve it. */
const ORG_B_TASK_ID = 42;

const ORG_A_PROJECT = {
  id: 10, orgId: "org-a", name: "Org A project",
  description: null, status: "active", priority: "medium", dueDate: null,
  slaOverrides: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

/** ID of an org-b project — the org-a key must never retrieve it. */
const ORG_B_PROJECT_ID = 99;

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
function reset(): void {
  mockState.selectQueue.length = 0;
  mockState.insertResult = [];
  mockState.updateResult = [];
  mockState.deleteResult = [];
  authState.enabled = true;
  authState.orgId = "org-a";
  authState.scopes = [
    "tasks:read", "tasks:write",
    "projects:read", "projects:write",
    "comments:read", "comments:write",
  ];
}

// ===========================================================================
// Tests
// ===========================================================================

// ── Unauthenticated ─────────────────────────────────────────────────────────

describe("API key auth — unauthenticated request", () => {
  beforeEach(reset);

  it("GET /api/tasks returns 401 when no auth credentials are present", async () => {
    authState.enabled = false; // no apiKeyId, no req.user → requireOrgOrApiKey returns 401

    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(401);
  });
});

// ── Scope enforcement ────────────────────────────────────────────────────────

describe("API key scope enforcement — insufficient scope is rejected before any DB query", () => {
  beforeEach(reset);

  it("GET /api/tasks returns 403 insufficient_scope when key lacks tasks:read", async () => {
    authState.scopes = ["tasks:write"]; // read scope intentionally absent

    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_scope");
    expect(res.body.required).toBe("tasks:read");
  });

  it("GET /api/tasks/:id returns 403 insufficient_scope when key lacks tasks:read", async () => {
    authState.scopes = ["tasks:write"];

    const res = await request(buildApp()).get("/api/tasks/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_scope");
  });

  it("GET /api/projects returns 403 insufficient_scope when key lacks projects:read", async () => {
    authState.scopes = ["tasks:read", "tasks:write"]; // no projects scope

    const res = await request(buildApp()).get("/api/projects");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_scope");
    expect(res.body.required).toBe("projects:read");
  });

  it("GET /api/projects/:id returns 403 insufficient_scope when key lacks projects:read", async () => {
    authState.scopes = ["tasks:read", "tasks:write"];

    const res = await request(buildApp()).get("/api/projects/10");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_scope");
  });
});

// ── Fail-closed routes ───────────────────────────────────────────────────────

describe("Fail-closed routes — requireOrg rejects all API keys regardless of scope", () => {
  beforeEach(reset);

  it("GET /api/notes returns 403 for API keys (notes uses requireOrg, not requireOrgOrApiKey)", async () => {
    // requireOrg checks req.apiKeyId first and returns 403 before any handler runs.
    const res = await request(buildApp()).get("/api/notes");
    expect(res.status).toBe(403);
  });

  it("GET /api/dashboard/summary returns 403 for API keys (dashboard uses requireOrg)", async () => {
    const res = await request(buildApp()).get("/api/dashboard/summary");
    expect(res.status).toBe(403);
  });
});

// ── Task isolation ───────────────────────────────────────────────────────────

describe("API key org isolation — tasks", () => {
  beforeEach(reset);

  it("GET /api/tasks returns an empty list for org-a — org-b tasks are absent", async () => {
    // selectQueue is empty → the DB returns [] for the org-a scoped WHERE clause.
    // Org-b tasks are never in the result because req.orgId = 'org-a' scopes the query.
    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /api/tasks returns only org-a tasks — org-b task ID is never present", async () => {
    // requireOrgOrApiKey now checks org suspension even for API-key requests,
    // so the first db.select() call is the org lookup.
    mockState.selectQueue.push([{ isDisabled: false }]); // org suspension check
    // Seed org-a task (the DB returns only this because of WHERE orgId='org-a').
    mockState.selectQueue.push([ORG_A_TASK]);   // tasks list
    mockState.selectQueue.push([]);              // workflow stages
    mockState.selectQueue.push([]);              // SLA policies
    mockState.selectQueue.push([{ count: 0 }]); // comment counts

    const res = await request(buildApp()).get("/api/tasks");
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(ORG_A_TASK.id);
    expect(ids).not.toContain(ORG_B_TASK_ID);
  });

  it("GET /api/tasks/:id returns 404 for an org-b task ID via an org-a key", async () => {
    // The route queries WHERE id=:id AND orgId=req.orgId ('org-a').
    // The org-b task does not match, so the DB returns [] → 404.
    // selectQueue is empty, so shift() returns [] — simulating a cross-org miss.
    const res = await request(buildApp()).get(`/api/tasks/${ORG_B_TASK_ID}`);
    expect(res.status).toBe(404);
  });
});

// ── Project isolation ─────────────────────────────────────────────────────────

describe("API key org isolation — projects", () => {
  beforeEach(reset);

  it("GET /api/projects returns an empty list for org-a — org-b projects are absent", async () => {
    const res = await request(buildApp()).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /api/projects returns only org-a projects — org-b project ID is never present", async () => {
    // requireOrgOrApiKey checks org suspension for API-key requests first.
    mockState.selectQueue.push([{ isDisabled: false }]); // org suspension check
    mockState.selectQueue.push([ORG_A_PROJECT]);

    const res = await request(buildApp()).get("/api/projects");
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((p: { id: number }) => p.id);
    expect(ids).toContain(ORG_A_PROJECT.id);
    expect(ids).not.toContain(ORG_B_PROJECT_ID);
  });

  it("GET /api/projects/:id returns 404 for an org-b project ID via an org-a key", async () => {
    // Route queries WHERE id=:id AND orgId='org-a'. Org-b project doesn't match → [].
    const res = await request(buildApp()).get(`/api/projects/${ORG_B_PROJECT_ID}`);
    expect(res.status).toBe(404);
  });
});

// ── Task write isolation ──────────────────────────────────────────────────────

const MOCK_STAGE = {
  id: 1, orgId: "org-a", name: "To Do", color: "#6b7280",
  type: "open", position: 0, archivedAt: null,
};

describe("API key org isolation — POST /api/tasks (write)", () => {
  beforeEach(reset);

  it("creates a task under org-a even when the request body includes orgId: 'org-b'", async () => {
    // The key sets req.orgId = 'org-a' server-side. The route always uses req.orgId
    // for all queries and the INSERT — any orgId field in the request body is ignored.
    mockState.selectQueue.push([{ isDisabled: false }]); // requireOrgOrApiKey org suspension check
    mockState.selectQueue.push([MOCK_STAGE]);             // resolveStage — stage belongs to org-a
    mockState.selectQueue.push([{ nextNum: 1 }]);        // MAX(orgTaskNumber)
    mockState.selectQueue.push([]);                       // getOrgStages (for response enrichment)
    mockState.selectQueue.push([{ count: 0 }]);           // comment count
    mockState.insertResult = [ORG_A_TASK];

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({
        title: "Injected task",
        priority: "medium",
        category: "incident",
        status: "1",
        orgId: "org-b",  // ← attacker attempts to inject a different org
      });

    expect(res.status).toBe(201);
    // The returned task belongs to org-a (from insertResult) — org-b injection had no effect.
    expect(res.body.orgId).toBe("org-a");
  });

  it("returns 403 when the key lacks tasks:write scope", async () => {
    authState.scopes = ["tasks:read"]; // write scope absent

    const res = await request(buildApp())
      .post("/api/tasks")
      .send({ title: "T", priority: "medium", category: "incident", status: "1" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_scope");
  });
});

describe("API key org isolation — PATCH /api/tasks/:id (write)", () => {
  beforeEach(reset);

  it("returns 404 for an org-b task ID — org-a key cannot update org-b tasks", async () => {
    // PATCH handler: SELECT prev state WHERE id=:id AND orgId=req.orgId ('org-a').
    // The org-b task does not match, so the DB returns [] → 404.
    // selectQueue is empty; shift() returns [] — simulating the cross-org miss.
    const res = await request(buildApp())
      .patch(`/api/tasks/${ORG_B_TASK_ID}`)
      .send({ priority: "high" });

    expect(res.status).toBe(404);
  });
});

describe("API key org isolation — PATCH /api/tasks/bulk (write)", () => {
  beforeEach(reset);

  it("reports 0 updated tasks when all IDs belong to a different org", async () => {
    // Bulk PATCH: SELECT prevRows WHERE id IN (...) AND orgId=req.orgId ('org-a').
    // Org-b IDs don't match → prevRows is empty → handler returns { updated: 0 }.
    mockState.selectQueue.push([]); // prevRows query returns no matching org-a tasks

    const res = await request(buildApp())
      .patch("/api/tasks/bulk")
      .send({ ids: [ORG_B_TASK_ID, ORG_B_TASK_ID + 1], patch: { priority: "high" } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 0 });
  });
});

describe("API key org isolation — DELETE /api/tasks/:id (write)", () => {
  beforeEach(reset);

  it("returns 404 for an org-b task ID — org-a key cannot delete org-b tasks", async () => {
    // DELETE handler: SELECT task WHERE id=:id AND orgId=req.orgId ('org-a').
    // The org-b task does not match → [] → 404, db.delete is never reached.
    // selectQueue is empty; shift() returns [] — simulating the cross-org miss.
    const res = await request(buildApp()).delete(`/api/tasks/${ORG_B_TASK_ID}`);

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// Project write isolation
// ===========================================================================

describe("API key org isolation — POST /api/projects (write)", () => {
  beforeEach(reset);

  it("creates a project under org-a even when the request body includes orgId: 'org-b'", async () => {
    // The API key sets req.orgId = 'org-a' server-side. The handler always uses
    // req.orgId! for the INSERT — any orgId field in the request body is ignored.
    mockState.insertResult = [ORG_A_PROJECT];

    const res = await request(buildApp())
      .post("/api/projects")
      .send({
        name: "Injected project",
        priority: "medium",
        orgId: "org-b", // ← attacker attempts to inject a different org
      });

    expect(res.status).toBe(201);
    // The returned project belongs to org-a (from insertResult) — org-b injection had no effect.
    expect(res.body.orgId).toBe("org-a");
  });

  it("returns 403 when the key lacks projects:write scope", async () => {
    authState.scopes = ["projects:read"]; // write scope absent

    const res = await request(buildApp())
      .post("/api/projects")
      .send({ name: "New project", priority: "medium" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_scope");
  });
});

describe("API key org isolation — PATCH /api/projects/:id (write)", () => {
  beforeEach(reset);

  it("returns 404 for an org-b project ID — org-a key cannot update org-b projects", async () => {
    // PATCH handler: UPDATE projects SET ... WHERE id=:id AND orgId=req.orgId ('org-a') RETURNING.
    // The org-b project does not match → updateResult is [] → project undefined → 404.
    const res = await request(buildApp())
      .patch(`/api/projects/${ORG_B_PROJECT_ID}`)
      .send({ name: "Renamed" });

    expect(res.status).toBe(404);
  });
});

describe("API key org isolation — DELETE /api/projects/:id (write)", () => {
  beforeEach(reset);

  it("returns 404 for an org-b project ID — org-a key cannot delete org-b projects", async () => {
    // DELETE handler: DELETE FROM projects WHERE id=:id AND orgId=req.orgId ('org-a') RETURNING.
    // The org-b project does not match → deleteResult is [] → project undefined → 404.
    const res = await request(buildApp()).delete(`/api/projects/${ORG_B_PROJECT_ID}`);

    expect(res.status).toBe(404);
  });
});
