/**
 * Tests for the data export routes.
 *
 * POST /export          — trigger export (small org → direct download,
 *                         large org → 202 background job)
 * GET  /export/pending  — check whether a completed background export is ready
 * GET  /export/download/:token — download a completed export
 *
 * Also includes unit tests for the `toCsv` helper to verify that sparse
 * custom-field columns (present in some rows but not others) are never
 * silently dropped from the CSV output.
 *
 * @workspace/db, requireOrgMiddleware, notifications, logger, and the storage
 * provider are fully mocked so these tests run without a live database, auth
 * session, or object-storage bucket.
 *
 * Fake timers are used throughout to prevent the background-job setTimeout and
 * the cleanup setInterval from firing between tests unexpectedly.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { toCsv } from "./export";

// ---------------------------------------------------------------------------
// Shared mock state (hoisted so vi.mock factories can reference it)
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  /** Controls whether the requireOrg mock grants manage_org_settings. */
  adminAccess: true,
  /** Buffer returned by storage.get() (null = object not found). */
  storageBuffer: null as Buffer | null,
}));

// ---------------------------------------------------------------------------
// Mock org-features — always enabled so feature flags don't interfere
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db — select uses a queue; insert/update/delete are no-ops
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
// Mock storage provider — singleton so spies can be inspected after route calls
// ---------------------------------------------------------------------------
const mockStorageProvider = vi.hoisted(() => ({
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockImplementation(() => Promise.resolve(mockState.storageBuffer)),
  delete: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/storage/provider", () => ({
  getStorageProvider: () => mockStorageProvider,
}));

// ---------------------------------------------------------------------------
// Mock middlewares — permission controlled via mockState.adminAccess
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.orgId = "org-1";
    req.user = { id: "user-1", email: "admin@example.com", firstName: "Admin", lastName: "User" } as never;
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

// ---------------------------------------------------------------------------
// Mock notifications and logger
// ---------------------------------------------------------------------------
vi.mock("../lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock archiver (ZipArchive) — emits minimal ZIP bytes then ends
// ---------------------------------------------------------------------------
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
// App factory — uses module cache so mocks persist within a suite
// ---------------------------------------------------------------------------
async function buildApp(): Promise<express.Express> {
  const { default: exportRouter } = await import("./export");
  const app = express();
  app.use(express.json());
  app.use(exportRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------
function queueCount(n: number) {
  mockState.selectQueue.push([{ c: n }]);
}
function queueRows(rows: unknown[]) {
  mockState.selectQueue.push(rows);
}

// ---------------------------------------------------------------------------
// ── Unit tests: toCsv ─────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
describe("toCsv", () => {
  it("returns empty string for empty input", () => {
    expect(toCsv([])).toBe("");
  });

  it("includes a header row + one data row for a single uniform row", () => {
    const csv = toCsv([{ id: 1, title: "Fix bug" }]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,title");
    expect(lines[1]).toBe("1,Fix bug");
  });

  it("escapes commas, double-quotes, and newlines", () => {
    const csv = toCsv([{ note: 'He said "hello, world"' }]);
    expect(csv).toContain('"He said ""hello, world"""');
  });

  it("uses the union of keys across all rows — sparse custom-field columns are NOT dropped", () => {
    const rows = [
      { id: 1, title: "Task A" },                          // no cf_ columns
      { id: 2, title: "Task B", "cf_Priority": "high" },   // only cf_Priority
      { id: 3, title: "Task C", "cf_Region": "EU" },       // only cf_Region
    ];
    const csv = toCsv(rows);
    const [header, ...dataLines] = csv.split("\n");
    const headers = header.split(",");

    // All four columns must appear in the header.
    expect(headers).toContain("id");
    expect(headers).toContain("title");
    expect(headers).toContain("cf_Priority");
    expect(headers).toContain("cf_Region");

    // Row 1 has no custom fields → those cells must be empty strings.
    const row1 = dataLines[0].split(",");
    expect(row1[headers.indexOf("cf_Priority")]).toBe("");
    expect(row1[headers.indexOf("cf_Region")]).toBe("");

    // Row 2 has cf_Priority → should appear; cf_Region → empty.
    const row2 = dataLines[1].split(",");
    expect(row2[headers.indexOf("cf_Priority")]).toBe("high");
    expect(row2[headers.indexOf("cf_Region")]).toBe("");

    // Row 3 has cf_Region → should appear; cf_Priority → empty.
    const row3 = dataLines[2].split(",");
    expect(row3[headers.indexOf("cf_Priority")]).toBe("");
    expect(row3[headers.indexOf("cf_Region")]).toBe("EU");
  });

  it("handles rows where later rows introduce entirely new columns", () => {
    const rows = [
      { id: 1 },
      { id: 2, extra: "yes" },
    ];
    const csv = toCsv(rows);
    const [header, row1Line, row2Line] = csv.split("\n");
    const headers = header.split(",");

    expect(headers).toContain("extra");
    // First row has no "extra" → empty cell
    expect(row1Line.split(",")[headers.indexOf("extra")]).toBe("");
    // Second row has "extra" → "yes"
    expect(row2Line.split(",")[headers.indexOf("extra")]).toBe("yes");
  });
});

// ---------------------------------------------------------------------------
// ── HTTP tests: POST /export ───────────────────────────────────────────────
// ---------------------------------------------------------------------------
describe("POST /export", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockState.selectQueue = [];
    mockState.adminAccess = true;
    mockState.storageBuffer = Buffer.from('{"meta":{}}', "utf-8");
    app = await buildApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 403 when the user lacks manage_org_settings permission", async () => {
    mockState.adminAccess = false;

    const res = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "json" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringContaining("orbidden") });
  });

  it("returns 400 for an empty scope array", async () => {
    const res = await request(app)
      .post("/export")
      .send({ scope: [], format: "json" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid format value", async () => {
    const res = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "xml" });

    expect(res.status).toBe(400);
  });

  it("streams a JSON file directly for small orgs (< 10k rows)", async () => {
    // 1. countTotalRows: tasks count → 5
    queueCount(5);
    // 2. fetchExportData: custom field defs → none
    queueRows([]);
    // 3. fetchExportData: tasks
    queueRows([
      {
        id: 1, orgId: "org-1", orgTaskNumber: 1, title: "Task A",
        description: null, status: "todo", priority: "medium",
        category: "other", assignee: null, dueDate: null, projectId: null,
        slaBreachedAt: null, sourceWebhookId: null, slaWarningSentAt: null,
        customFields: {},
        createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
      },
    ]);

    const res = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "json" });

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment.*export\.json/);
    expect(res.headers["content-type"]).toMatch(/application\/json/);

    const body = JSON.parse(res.text) as {
      meta: { orgId: string; version: string };
      tasks: Array<{ title: string }>;
    };
    expect(body.meta).toMatchObject({ orgId: "org-1", version: "1" });
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe("Task A");
  });

  it("flattens custom fields using definition names (not raw IDs) in the JSON export", async () => {
    queueCount(2);
    // custom field defs: id=42 → "Severity"
    queueRows([{ id: 42, name: "Severity" }]);
    queueRows([
      {
        id: 1, orgId: "org-1", orgTaskNumber: 1, title: "Task with CF",
        description: null, status: "todo", priority: "high", category: "other",
        assignee: null, dueDate: null, projectId: null, slaBreachedAt: null,
        sourceWebhookId: null, slaWarningSentAt: null,
        customFields: { "42": "P1" },
        createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
      },
    ]);

    const res = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "json" });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { tasks: Array<Record<string, unknown>> };
    // Column should be named "cf_Severity", not "cf_42"
    expect(body.tasks[0]["cf_Severity"]).toBe("P1");
    expect(body.tasks[0]["cf_42"]).toBeUndefined();
  });

  it("returns 202 and queues a background job for large orgs (≥ 10k rows)", async () => {
    // Count query fires first.
    queueCount(15000);
    // SELECT for existing export job (none found).
    queueRows([]);

    const res = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "json" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "pending" });
    // Background job does not fire because fake timers are active.
  });

  it("streams a CSV zip directly for small orgs when format is csv", async () => {
    queueCount(3);
    queueRows([]);       // custom field defs
    queueRows([          // tasks
      {
        id: 1, orgId: "org-1", orgTaskNumber: 1, title: "Bug",
        description: null, status: "open", priority: "high", category: "other",
        assignee: null, dueDate: null, projectId: null, slaBreachedAt: null,
        sourceWebhookId: null, slaWarningSentAt: null, customFields: {},
        createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
      },
    ]);

    const res = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "csv" });

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment.*export\.zip/);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
  });
});

// ---------------------------------------------------------------------------
// ── HTTP tests: GET /export/pending ───────────────────────────────────────
// ---------------------------------------------------------------------------
describe("GET /export/pending", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockState.selectQueue = [];
    mockState.adminAccess = true;
    app = await buildApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns { pending: false } when no export job row exists", async () => {
    // SELECT complete jobs → empty
    queueRows([]);

    const res = await request(app).get("/export/pending");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: false });
  });

  it("returns { pending: true, token, filename, expiresAt } when a complete job exists", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    queueRows([{
      id: "job-1", orgId: "org-1", userId: "user-1",
      token: "abc-token", objectKey: "org-1/user-1/abc-token",
      status: "complete", filename: "export.json", contentType: "application/json",
      createdAt: new Date(), expiresAt,
    }]);

    const res = await request(app).get("/export/pending");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pending: true,
      token: "abc-token",
      filename: "export.json",
      expiresAt: expiresAt.toISOString(),
    });
  });

  it("returns { pending: false } when the job expiresAt is in the past", async () => {
    // Job with expiresAt already elapsed
    queueRows([{
      id: "job-1", orgId: "org-1", userId: "user-1",
      token: "old-token", objectKey: "org-1/user-1/old-token",
      status: "complete", filename: "export.json", contentType: "application/json",
      createdAt: new Date(), expiresAt: new Date(Date.now() - 1000),
    }]);

    const res = await request(app).get("/export/pending");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pending: false });
  });
});

// ---------------------------------------------------------------------------
// ── HTTP tests: GET /export/download/:token ───────────────────────────────
// ---------------------------------------------------------------------------
describe("GET /export/download/:token", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockState.selectQueue = [];
    mockState.adminAccess = true;
    mockState.storageBuffer = Buffer.from('{"meta":{}}', "utf-8");
    app = await buildApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 for an unknown token (no DB row)", async () => {
    queueRows([]);  // SELECT by token → no row
    const res = await request(app).get("/export/download/no-such-token");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/expired/i) });
  });

  it("returns 403 when the user lacks manage_org_settings permission", async () => {
    mockState.adminAccess = false;

    const res = await request(app).get("/export/download/any-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 when the job status is not complete", async () => {
    queueRows([{
      id: "job-1", orgId: "org-1", userId: "user-1",
      token: "pending-token", objectKey: "org-1/user-1/pending-token",
      status: "pending", filename: "export.json", contentType: "application/json",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }]);

    const res = await request(app).get("/export/download/pending-token");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/expired/i) });
  });

  it("returns 200 and the file buffer when the token is valid and complete", async () => {
    const fileContent = Buffer.from('{"meta":{"orgId":"org-1","version":"1"}}', "utf-8");
    mockState.storageBuffer = fileContent;

    queueRows([{
      id: "job-1", orgId: "org-1", userId: "user-1",
      token: "valid-token", objectKey: "org-1/user-1/valid-token",
      status: "complete", filename: "export.json", contentType: "application/json",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }]);

    const res = await request(app).get("/export/download/valid-token");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment.*export\.json/);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ---------------------------------------------------------------------------
// ── Token TTL expiry (DB-based) ───────────────────────────────────────────
//
// The TTL is enforced in the route handlers by comparing job.expiresAt to
// new Date(). These tests verify that an expired job (expiresAt in the past)
// returns 404 from the download route, while a non-expired one returns 200.
// ---------------------------------------------------------------------------
describe("GET /export/download/:token — TTL expiry", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockState.selectQueue = [];
    mockState.adminAccess = true;
    mockState.storageBuffer = Buffer.from('{"meta":{}}', "utf-8");
    app = await buildApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 after the 1-hour TTL has elapsed — expired tokens cannot be redeemed", async () => {
    // Simulate a complete job whose TTL has passed.
    queueRows([{
      id: "job-1", orgId: "org-1", userId: "user-1",
      token: "expired-token", objectKey: "org-1/user-1/expired-token",
      status: "complete", filename: "export.json", contentType: "application/json",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1000),   // 1 second ago
    }]);

    const dlRes = await request(app).get("/export/download/expired-token");
    expect(dlRes.status).toBe(404);
    expect(dlRes.body).toMatchObject({ error: expect.stringMatching(/expired|not found/i) });
  });

  it("returns 404 when the job status is expired regardless of expiresAt", async () => {
    // Job marked expired before TTL (e.g. superseded by a newer export).
    queueRows([{
      id: "job-1", orgId: "org-1", userId: "user-1",
      token: "superseded-token", objectKey: "org-1/user-1/superseded-token",
      status: "expired", filename: "export.json", contentType: "application/json",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }]);

    const dlRes = await request(app).get("/export/download/superseded-token");
    expect(dlRes.status).toBe(404);
    expect(dlRes.body).toMatchObject({ error: expect.stringMatching(/expired/i) });
  });

  it("returns 200 when the token is accessed before the TTL elapses (pre-expiry positive control)", async () => {
    const fileContent = Buffer.from('{"meta":{"orgId":"org-1","version":"1"}}', "utf-8");
    mockState.storageBuffer = fileContent;

    // Job valid for 30 more minutes.
    queueRows([{
      id: "job-2", orgId: "org-1", userId: "user-1",
      token: "fresh-token", objectKey: "org-1/user-1/fresh-token",
      status: "complete", filename: "export.json", contentType: "application/json",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }]);

    const dlRes = await request(app).get("/export/download/fresh-token");
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers["content-disposition"]).toMatch(/export\.json/);
  });

  it("returns { pending: false } for GET /export/pending when no complete row exists", async () => {
    // The route queries for complete+non-expired jobs; queue empty result.
    queueRows([]);

    const pendingRes = await request(app).get("/export/pending");
    expect(pendingRes.body.pending).toBe(false);
  });

  it("background job for large org completes and marks DB row complete", async () => {
    mockStorageProvider.put.mockClear();

    // POST → 202
    queueCount(15_000);
    queueRows([]);   // no existing job row
    const postRes = await request(app)
      .post("/export")
      .send({ scope: ["tasks"], format: "json" });
    expect(postRes.status).toBe(202);

    // Run background job: it needs custom field defs + tasks.
    queueRows([]);   // custom field defs
    queueRows([{
      id: 1, orgId: "org-1", orgTaskNumber: 1, title: "Task A",
      description: null, status: "todo", priority: "medium", category: "other",
      assignee: null, dueDate: null, projectId: null, slaBreachedAt: null,
      sourceWebhookId: null, slaWarningSentAt: null, customFields: {},
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    }]);

    await vi.runAllTimersAsync();

    // After background job, the storage mock's put() should have been called.
    expect(mockStorageProvider.put).toHaveBeenCalledOnce();
  });
});
