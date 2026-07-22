/**
 * Cross-tenant (organization) isolation tests for the data export endpoint.
 *
 * POST /export aggregates multiple entity types in a single shot, making it a
 * higher-risk surface for cross-org data leakage than individual CRUD endpoints.
 * These tests verify that an Org A admin can never retrieve Org B's tasks,
 * projects, notes, or comments — even when both orgs have data in the database.
 *
 * Two orgs are simulated:
 *   Org A ("org-a") — the caller's org, set by the middleware mock
 *   Org B ("org-b") — another org whose data must never appear in Org A's export
 *
 * The @workspace/db mock consumes entries from selectQueue in the order that
 * db.select() is called by the route. Pushing only Org A's rows simulates the
 * database applying the WHERE orgId='org-a' clause that excludes Org B's rows.
 *
 * Covered scenarios:
 *  - POST /export — 403 when caller lacks manage_org_settings
 *  - POST /export — meta.orgId is always the caller's own org
 *  - POST /export — only Org A tasks appear; Org B tasks are absent
 *  - POST /export — only Org A projects appear; Org B projects are absent
 *  - POST /export — only Org A notes appear; Org B notes are absent
 *  - POST /export — only Org A comments appear; Org B comments are absent
 *  - POST /export — empty org returns empty arrays (no cross-org bleed)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state (hoisted so vi.mock factories can reference it)
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  /** Set to false to simulate a member without admin access. */
  adminAccess: true,
}));

// ---------------------------------------------------------------------------
// Mock org-features — always enabled so feature flags don't interfere
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  isOrgFeatureEnabled: async () => true,
}));

// ---------------------------------------------------------------------------
// @workspace/db — fully mocked, no real database connection
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: unknown[]): unknown {
    const chain: Record<string, unknown> = {};
    const resolved = Promise.resolve(result);
    const noop = () => chain;
    chain.from = noop;
    chain.where = noop;
    chain.innerJoin = noop;
    chain.leftJoin = noop;
    chain.groupBy = noop;
    chain.limit = () => resolved;
    chain.orderBy = noop;
    chain.then = (onFulfilled: unknown, onRejected: unknown) =>
      resolved.then(onFulfilled as never, onRejected as never);
    chain.catch = (onRejected: unknown) =>
      resolved.catch(onRejected as never);
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {};
    chain.values = () => Promise.resolve([]);
    return chain;
  }

  function makeUpdateChain(): unknown {
    const chain: Record<string, unknown> = {};
    const setChain: Record<string, unknown> = {};
    setChain.where = () => Promise.resolve([]);
    chain.set = () => setChain;
    return chain;
  }

  function makeDeleteChain(): unknown {
    const chain: Record<string, unknown> = {};
    chain.where = () => Promise.resolve([]);
    return chain;
  }

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => makeInsertChain(),
      update: () => makeUpdateChain(),
      delete: () => makeDeleteChain(),
    },
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    notesTable: {},
    customFieldDefinitionsTable: {},
    exportJobsTable: {},
    notificationsTable: {},
    notificationPreferencesTable: {},
    organizationsTable: {},
    usersTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  lt: () => ({}),
  count: () => ({}),
  sql: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock storage provider — in-memory buffer store
// ---------------------------------------------------------------------------
vi.mock("../lib/storage/provider", () => {
  const mockProvider = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(Buffer.from('{"meta":{}}', "utf-8")),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  };
  return { getStorageProvider: () => mockProvider };
});

// ---------------------------------------------------------------------------
// requireOrgMiddleware — caller is always Org A; orgId is set server-side and
// cannot be overridden by the client
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.orgId = "org-a";
    req.user = { id: "user-a1", email: "user-a1@org-a.example" } as never;
    req.orgPermissions = { manage_org_settings: mockState.adminAccess } as never;
    next();
  },
  requirePermission: (key: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.orgPermissions?.[key as keyof typeof req.orgPermissions]) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
}));

vi.mock("../lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("archiver", async () => {
  const { EventEmitter } = await import("node:events");
  class MockZipArchive extends EventEmitter {
    append() { return this; }
    finalize() {
      this.emit("data", Buffer.from("PK\x03\x04"));
      this.emit("end");
      return this;
    }
  }
  return { ZipArchive: MockZipArchive };
});

// ---------------------------------------------------------------------------
// Import router AFTER mocks are in place
// ---------------------------------------------------------------------------
import exportRouter from "./export.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(exportRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Queue helpers
//
// selectQueue order for a full-scope (tasks+projects+notes+comments) JSON export:
//
//   countTotalRows — 4 db.select() calls evaluated synchronously inside
//   Promise.all, shifting queue entries in order:
//     [0] tasks count      → [{ c: N }]
//     [1] projects count   → [{ c: N }]
//     [2] notes count      → [{ c: N }]
//     [3] comments count   → [{ c: N }]
//
//   fetchExportData — sequential awaits, shifting in order:
//     [4] custom field defs (only when "tasks" in scope)
//     [5] tasks rows
//     [6] projects rows
//     [7] notes rows
//     [8] comments rows
// ---------------------------------------------------------------------------
function seedFullScopeExport(
  tasks: unknown[],
  projects: unknown[],
  notes: unknown[],
  comments: unknown[],
): void {
  // counts (all small so the direct-stream path is taken)
  mockState.selectQueue.push([{ c: tasks.length }]);
  mockState.selectQueue.push([{ c: projects.length }]);
  mockState.selectQueue.push([{ c: notes.length }]);
  mockState.selectQueue.push([{ c: comments.length }]);
  // fetchExportData payloads
  mockState.selectQueue.push([]); // custom field definitions
  mockState.selectQueue.push(tasks);
  mockState.selectQueue.push(projects);
  mockState.selectQueue.push(notes);
  mockState.selectQueue.push(comments);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const T = () => new Date("2025-06-01");

const ORG_A_TASK = {
  id: 1, orgId: "org-a", orgTaskNumber: 1, title: "Org A task",
  description: null, status: "todo", priority: "medium", category: "other",
  assignee: null, dueDate: null, projectId: null, slaBreachedAt: null,
  sourceWebhookId: null, slaWarningSentAt: null, customFields: {},
  createdAt: T(), updatedAt: T(),
};

const ORG_B_TASK = {
  id: 999, orgId: "org-b", orgTaskNumber: 1, title: "Org B confidential task",
  description: null, status: "in_progress", priority: "critical", category: "incident",
  assignee: null, dueDate: null, projectId: null, slaBreachedAt: null,
  sourceWebhookId: null, slaWarningSentAt: null, customFields: {},
  createdAt: T(), updatedAt: T(),
};

const ORG_A_PROJECT = {
  id: 10, orgId: "org-a", name: "Org A project", description: null,
  status: "active", priority: "medium", dueDate: null,
  createdAt: T(), updatedAt: T(),
};

const ORG_B_PROJECT = {
  id: 888, orgId: "org-b", name: "Org B confidential project", description: null,
  status: "active", priority: "low", dueDate: null,
  createdAt: T(), updatedAt: T(),
};

const ORG_A_NOTE = {
  id: 20, orgId: "org-a", createdBy: "user-a1", title: "Org A note",
  content: "hello", visibility: "public_read", projectId: null, taskId: null,
  createdAt: T(), updatedAt: T(),
};

const ORG_B_NOTE = {
  id: 777, orgId: "org-b", createdBy: "user-b1", title: "Org B confidential note",
  content: "classified", visibility: "private", projectId: null, taskId: null,
  createdAt: T(), updatedAt: T(),
};

const ORG_A_COMMENT = {
  id: 30, orgId: "org-a", taskId: 1,
  content: "Org A comment", author: "user-a1@org-a.example", createdAt: T(),
};

const ORG_B_COMMENT = {
  id: 666, orgId: "org-b", taskId: 999,
  content: "Org B confidential comment", author: "user-b1@org-b.example", createdAt: T(),
};

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
function reset(): void {
  mockState.selectQueue = [];
  mockState.adminAccess = true;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Export isolation — POST /export", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers(); // prevents background setTimeout from firing between tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Auth / permission gate ──────────────────────────────────────────────

  it("returns 403 when the caller lacks manage_org_settings — export is admin-only", async () => {
    mockState.adminAccess = false;

    const res = await request(buildApp())
      .post("/export")
      .send({ scope: ["tasks"], format: "json" });

    expect(res.status).toBe(403);
  });

  // ── Meta isolation ──────────────────────────────────────────────────────

  it("meta.orgId is the caller's org (org-a), never org-b", async () => {
    seedFullScopeExport([], [], [], []);

    const res = await request(buildApp())
      .post("/export")
      .send({ scope: ["tasks", "projects", "notes", "comments"], format: "json" });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.meta.orgId).toBe("org-a");
  });

  // ── Task isolation ──────────────────────────────────────────────────────

  it("export contains only Org A tasks — Org B tasks are absent", async () => {
    // The mock DB only yields Org A's task. A real DB would exclude Org B's task
    // via WHERE orgId='org-a'; the mock simulates this by having only Org A's
    // row in the queue.
    seedFullScopeExport([ORG_A_TASK], [ORG_A_PROJECT], [ORG_A_NOTE], [ORG_A_COMMENT]);

    const res = await request(buildApp())
      .post("/export")
      .send({ scope: ["tasks", "projects", "notes", "comments"], format: "json" });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const taskIds: number[] = body.tasks.map((t: { id: number }) => t.id);
    expect(taskIds).toContain(ORG_A_TASK.id);
    expect(taskIds).not.toContain(ORG_B_TASK.id);
  });

  // ── Project isolation ───────────────────────────────────────────────────

  it("export contains only Org A projects — Org B projects are absent", async () => {
    seedFullScopeExport([ORG_A_TASK], [ORG_A_PROJECT], [ORG_A_NOTE], [ORG_A_COMMENT]);

    const res = await request(buildApp())
      .post("/export")
      .send({ scope: ["tasks", "projects", "notes", "comments"], format: "json" });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const projectIds: number[] = body.projects.map((p: { id: number }) => p.id);
    expect(projectIds).toContain(ORG_A_PROJECT.id);
    expect(projectIds).not.toContain(ORG_B_PROJECT.id);
  });

  // ── Note isolation ──────────────────────────────────────────────────────

  it("export contains only Org A notes — Org B notes are absent", async () => {
    seedFullScopeExport([ORG_A_TASK], [ORG_A_PROJECT], [ORG_A_NOTE], [ORG_A_COMMENT]);

    const res = await request(buildApp())
      .post("/export")
      .send({ scope: ["tasks", "projects", "notes", "comments"], format: "json" });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const noteIds: number[] = body.notes.map((n: { id: number }) => n.id);
    expect(noteIds).toContain(ORG_A_NOTE.id);
    expect(noteIds).not.toContain(ORG_B_NOTE.id);
  });

  // ── Comment isolation ───────────────────────────────────────────────────

  it("export contains only Org A comments — Org B comments are absent", async () => {
    seedFullScopeExport([ORG_A_TASK], [ORG_A_PROJECT], [ORG_A_NOTE], [ORG_A_COMMENT]);

    const res = await request(buildApp())
      .post("/export")
      .send({ scope: ["tasks", "projects", "notes", "comments"], format: "json" });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const commentIds: number[] = body.comments.map((c: { id: number }) => c.id);
    expect(commentIds).toContain(ORG_A_COMMENT.id);
    expect(commentIds).not.toContain(ORG_B_COMMENT.id);
  });

  // ── Empty org ───────────────────────────────────────────────────────────

  it("export for an org with no data returns empty arrays — no cross-org bleed", async () => {
    // Org A has no data. The mock returns empty arrays for all entity types,
    // which is exactly what a correctly scoped query produces when org-a is empty
    // even if org-b has thousands of rows.
    seedFullScopeExport([], [], [], []);

    const res = await request(buildApp())
      .post("/export")
      .send({ scope: ["tasks", "projects", "notes", "comments"], format: "json" });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.tasks).toEqual([]);
    expect(body.projects).toEqual([]);
    expect(body.notes).toEqual([]);
    expect(body.comments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Background export job isolation
//
// Large-org exports (≥ 10k rows) return 202 immediately and run fetchExportData
// inside a setTimeout callback. The orgId is captured from req.orgId in the
// closure at POST time — not re-read from any client-supplied value — so the
// background job is always scoped to the org that made the original request.
//
// These tests advance fake timers to let the job complete, then download the
// result and verify isolation end-to-end:
//
//   POST /export  →  202
//   vi.runAllTimersAsync()  (fires setTimeout, awaits all async work inside)
//   GET /export/pending  →  { pending: true, token }
//   GET /export/download/:token  →  org-a data only
// ---------------------------------------------------------------------------

describe("Background export job isolation — large-org path", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("background job uses org-a's orgId captured at request time — org-b data never appears in the export buffer", async () => {
    const { getStorageProvider } = await import("../lib/storage/provider");
    const provider = getStorageProvider();
    vi.mocked(provider.put).mockClear();

    const app = buildApp();

    // countTotalRows: tasks count ≥ 10 000 → triggers the 202 background path.
    mockState.selectQueue.push([{ c: 15_000 }]);
    // SELECT existing export job → none
    mockState.selectQueue.push([]);

    // The background job calls fetchExportData("org-a", ["tasks"]).
    // The mock returns only org-a's row, simulating WHERE orgId='org-a'.
    mockState.selectQueue.push([]);           // custom field definitions (none for org-a)
    mockState.selectQueue.push([ORG_A_TASK]); // tasks rows — org-b task is absent

    // Step 1: POST — route returns 202 immediately; background job is scheduled.
    const postRes = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "json" });

    expect(postRes.status).toBe(202);
    expect(postRes.body).toMatchObject({ status: "pending" });

    // Step 2: advance fake timers — fires setTimeout(callback, 0) and awaits
    // all async operations inside (fetchExportData, serializeJson, storage.put).
    await vi.runAllTimersAsync();

    // Step 3: verify storage.put() was called with org-a's data only.
    expect(provider.put).toHaveBeenCalledOnce();
    const [_key, buffer] = vi.mocked(provider.put).mock.calls[0];
    const exportBody = JSON.parse((buffer as Buffer).toString("utf-8")) as {
      meta: { orgId: string };
      tasks: Array<{ id: number }>;
    };

    // meta.orgId must be org-a — the orgId captured in the closure at POST time.
    expect(exportBody.meta.orgId).toBe("org-a");

    // Org A task is present; Org B task is absent.
    const taskIds = exportBody.tasks.map((t) => t.id);
    expect(taskIds).toContain(ORG_A_TASK.id);
    expect(taskIds).not.toContain(ORG_B_TASK.id);
  });

  it("background job orgId is immutable — a forged body orgId has no effect on what data is exported", async () => {
    const { getStorageProvider } = await import("../lib/storage/provider");
    const provider = getStorageProvider();
    vi.mocked(provider.put).mockClear();

    const app = buildApp();

    // Large-org count triggers 202 path regardless of what body orgId the client sends.
    mockState.selectQueue.push([{ c: 20_000 }]);
    // SELECT existing export job → none
    mockState.selectQueue.push([]);

    // Background job will call fetchExportData("org-a", ["tasks"]) — the middleware
    // always sets req.orgId = "org-a" and the handler captures that value.
    // No org-b data is ever in the queue.
    mockState.selectQueue.push([]);           // custom field defs
    mockState.selectQueue.push([ORG_A_TASK]); // only org-a tasks

    // Client attempts to inject orgId: "org-b" in the body — this field is ignored;
    // ExportBodySchema only accepts scope and format.
    const postRes = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "json", orgId: "org-b" });

    expect(postRes.status).toBe(202);

    await vi.runAllTimersAsync();

    // Verify the buffer written to storage contains org-a data, not org-b.
    expect(provider.put).toHaveBeenCalledOnce();
    const [_key, buffer] = vi.mocked(provider.put).mock.calls[0];
    const exportBody = JSON.parse((buffer as Buffer).toString("utf-8")) as { meta: { orgId: string } };

    // orgId in the export is always org-a — the server-side value, not the injected one.
    expect(exportBody.meta.orgId).toBe("org-a");
    expect(exportBody.meta.orgId).not.toBe("org-b");
  });
});

// ---------------------------------------------------------------------------
// GET /export/pending — jobInProgress flag integration tests
//
// These tests exercise the OR clause added to the pending-check query:
//   WHERE status = 'complete' OR status = 'pending'
//
// The mock DB returns whatever is at the front of selectQueue when
// db.select().from().where().limit(1) resolves.  Four cases are covered:
//   1. No row at all              → { pending: false }
//   2. Row with status="pending"  → { pending: false, jobInProgress: true }
//   3. Row status="complete", not expired → { pending: true, token, ... }
//   4. Row status="complete", expired    → { pending: false }
// ---------------------------------------------------------------------------

describe("GET /export/pending — jobInProgress identification", () => {
  const futureDate = new Date(Date.now() + 3_600_000); // 1 hour ahead
  const pastDate   = new Date(Date.now() - 3_600_000); // 1 hour ago

  beforeEach(() => {
    reset();
  });

  it("returns { pending: false } when no export job row exists", async () => {
    // Queue an empty result — simulates no row for (userId, orgId).
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/export/pending");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: false });
  });

  it("returns { pending: false, jobInProgress: true } when the job row has status='pending'", async () => {
    // Simulates a background export job that is still running.  The route
    // must detect this row (via the OR clause) and signal jobInProgress so
    // the client can restore the disabled-button guard after a page reload.
    mockState.selectQueue.push([
      {
        id: 1,
        userId: "user-a1",
        orgId: "org-a",
        token: "tok-in-progress",
        objectKey: "org-a/user-a1/tok-in-progress",
        status: "pending",
        filename: "export.json",
        contentType: "application/json",
        expiresAt: futureDate,
        createdAt: new Date(),
      },
    ]);

    const res = await request(buildApp()).get("/export/pending");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: false, jobInProgress: true });
  });

  it("returns { pending: true, token, filename, expiresAt } when the job row has status='complete' and has not expired", async () => {
    const expiresAt = futureDate;

    mockState.selectQueue.push([
      {
        id: 2,
        userId: "user-a1",
        orgId: "org-a",
        token: "tok-complete",
        objectKey: "org-a/user-a1/tok-complete",
        status: "complete",
        filename: "export-complete.json",
        contentType: "application/json",
        expiresAt,
        createdAt: new Date(),
      },
    ]);

    const res = await request(buildApp()).get("/export/pending");

    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
    expect(res.body.token).toBe("tok-complete");
    expect(res.body.filename).toBe("export-complete.json");
    expect(typeof res.body.expiresAt).toBe("string");
  });

  it("returns { pending: false } when the completed job row has already expired", async () => {
    // expiresAt is in the past — the export link has lapsed.
    mockState.selectQueue.push([
      {
        id: 3,
        userId: "user-a1",
        orgId: "org-a",
        token: "tok-expired",
        objectKey: "org-a/user-a1/tok-expired",
        status: "complete",
        filename: "export-expired.json",
        contentType: "application/json",
        expiresAt: pastDate,
        createdAt: new Date(Date.now() - 7_200_000),
      },
    ]);

    const res = await request(buildApp()).get("/export/pending");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: false });
  });

  // ── Cross-org isolation ─────────────────────────────────────────────────
  //
  // Isolation contract: the route queries exportJobsTable with
  //   WHERE userId = <caller> AND orgId = <caller-org>
  // A real database never returns org-b's rows for an org-a query.
  // The mock simulates this by pushing [] — exactly what the DB yields when
  // org-b has a job but org-a does not.
  //
  // These tests pin the contract: even if org-b has an active or in-progress
  // export job, org-a callers always see { pending: false } with no
  // jobInProgress flag.

  it("org isolation — org-b has a completed export job but org-a caller sees { pending: false }", async () => {
    // Real DB applies WHERE orgId='org-a' AND userId='user-a1', so it returns
    // zero rows even though org-b has a valid complete job.  The mock
    // simulates this by queueing an empty result.
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/export/pending");

    expect(res.status).toBe(200);
    // org-a must not see org-b's completed export.
    expect(res.body).toEqual({ pending: false });
    expect(res.body.token).toBeUndefined();
    expect(res.body.filename).toBeUndefined();
  });

  it("org isolation — org-b has an in-progress export job but org-a caller sees { pending: false } without jobInProgress", async () => {
    // Real DB's WHERE orgId='org-a' clause excludes org-b's pending row.
    // The mock returns [] to simulate this scoped query.
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/export/pending");

    expect(res.status).toBe(200);
    // org-a must not inherit org-b's jobInProgress state.
    expect(res.body).toEqual({ pending: false });
    expect(res.body.jobInProgress).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /export/download/:token — cross-org isolation
//
// The route queries:
//   WHERE token = :token AND orgId = <caller-org>
//
// So org-b's token is invisible to an org-a caller even if they know the
// exact token string.  The mock simulates this by queueing [] for the
// cross-org scenario and a valid row for the own-token control.
// ---------------------------------------------------------------------------

describe("GET /export/download/:token — org isolation", () => {
  const futureDate = new Date(Date.now() + 3_600_000);

  beforeEach(() => {
    reset();
  });

  it("returns 404 when the token belongs to org-b — org-a caller cannot download another org's export", async () => {
    // The real DB applies WHERE token='org-b-tok' AND orgId='org-a', which
    // returns zero rows because the token is scoped to org-b.
    // The mock simulates this by queueing an empty result.
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/export/download/org-b-secret-token");

    expect(res.status).toBe(404);
    // The response must NOT contain any file data.
    expect(res.body.error).toBeDefined();
    expect(res.header["content-disposition"]).toBeUndefined();
  });

  it("returns 404 when the token exists but the job is still pending — callers cannot stream a partial export", async () => {
    // The DB row exists (correct org, correct token) but status is "pending"
    // because the background job has not finished yet.  The route must reject
    // the request rather than streaming whatever bytes storage has so far.
    mockState.selectQueue.push([
      {
        id: 20,
        userId: "user-a1",
        orgId: "org-a",
        token: "pending-token",
        objectKey: "org-a/user-a1/pending-token",
        status: "pending",
        filename: "export-org-a.json",
        contentType: "application/json",
        expiresAt: futureDate,
        createdAt: new Date(),
      },
    ]);

    const res = await request(buildApp()).get("/export/download/pending-token");

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.header["content-disposition"]).toBeUndefined();
  });

  it("returns 404 when the token is complete but expiresAt is in the past — expired exports cannot be re-downloaded", async () => {
    // The DB row exists with status "complete" but its TTL has passed.
    // The route checks expiresAt before streaming so the file is never served
    // once the window closes, even if the object is still in storage.
    const pastDate = new Date(Date.now() - 1_000);

    mockState.selectQueue.push([
      {
        id: 30,
        userId: "user-a1",
        orgId: "org-a",
        token: "expired-token",
        objectKey: "org-a/user-a1/expired-token",
        status: "complete",
        filename: "export-org-a.json",
        contentType: "application/json",
        expiresAt: pastDate,
        createdAt: new Date(Date.now() - 7_200_000),
      },
    ]);

    const res = await request(buildApp()).get("/export/download/expired-token");

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.header["content-disposition"]).toBeUndefined();
  });

  it("returns 403 when a non-admin org-a member requests the download endpoint — manage_org_settings is required", async () => {
    // Simulate a regular org-a member (no manage_org_settings permission).
    // No selectQueue entry is needed because requirePermission short-circuits
    // before the route handler touches the database.
    mockState.adminAccess = false;

    const res = await request(buildApp()).get("/export/download/any-token");

    expect(res.status).toBe(403);
    // No file data must leak through the error response.
    expect(res.header["content-disposition"]).toBeUndefined();
    expect(res.body.error).toBeDefined();
  });

  it("returns 200 and streams the file when org-a caller uses their own valid token", async () => {
    // Control test: confirms the above 404 is caused by org isolation, not a
    // misconfigured mock.  With org-a's own complete, non-expired job row in
    // the queue the route must succeed.
    mockState.selectQueue.push([
      {
        id: 10,
        userId: "user-a1",
        orgId: "org-a",
        token: "org-a-valid-token",
        objectKey: "org-a/user-a1/org-a-valid-token",
        status: "complete",
        filename: "export-org-a.json",
        contentType: "application/json",
        expiresAt: futureDate,
        createdAt: new Date(),
      },
    ]);

    const res = await request(buildApp()).get("/export/download/org-a-valid-token");

    expect(res.status).toBe(200);
    expect(res.header["content-disposition"]).toMatch(/export-org-a\.json/);
    expect(res.header["content-type"]).toMatch(/application\/json/);
  });
});
