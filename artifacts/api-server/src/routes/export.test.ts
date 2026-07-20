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
 * @workspace/db, requireOrgMiddleware, notifications, and logger are fully
 * mocked so these tests run without a live database or auth session.
 *
 * Fake timers are used throughout to prevent the background-job setTimeout
 * from firing between tests and polluting the in-memory pending-export Maps.
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
}));

// ---------------------------------------------------------------------------
// Mock org-features — always enabled so feature flags don't interfere
// ---------------------------------------------------------------------------
vi.mock("../lib/org-features", () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  isOrgFeatureEnabled: async () => true,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
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

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
    },
    tasksTable: {},
    projectsTable: {},
    commentsTable: {},
    notesTable: {},
    customFieldDefinitionsTable: {},
    notificationsTable: {},
    notificationPreferencesTable: {},
    organizationsTable: {},
    usersTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  count: () => ({}),
  sql: () => ({}),
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
}));

// ---------------------------------------------------------------------------
// Mock notifications and logger
// ---------------------------------------------------------------------------
vi.mock("../lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
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
// App factory — uses module cache so in-memory Maps persist within a suite
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
    vi.useFakeTimers();   // prevents background setTimeout from firing
    mockState.selectQueue = [];
    mockState.adminAccess = true;
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
    expect(res.body).toMatchObject({ error: expect.stringContaining("Admin") });
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
    // Only the count query fires; fetchExportData is deferred to setTimeout.
    queueCount(15000);

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
    vi.useFakeTimers();   // keeps background jobs from writing to the Maps
    mockState.selectQueue = [];
    mockState.adminAccess = true;
    app = await buildApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns { pending: false } when no export has been completed", async () => {
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
    app = await buildApp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get("/export/download/no-such-token");
    expect(res.status).toBe(404);
  });

  it("returns 403 when the user lacks manage_org_settings permission", async () => {
    mockState.adminAccess = false;

    const res = await request(app).get("/export/download/any-token");
    expect(res.status).toBe(403);
  });
});
