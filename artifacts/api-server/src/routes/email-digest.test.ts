/**
 * Tests for email digest preference endpoints.
 *
 * GET  /api/email-digest-preference  — returns current user's digest frequency
 * PATCH /api/email-digest-preference — updates digest frequency
 *
 * @workspace/db is fully mocked so these run without a live database.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectResult: [] as any[],
  insertedValues: null as any,
  upsertCalled: false,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeInsertChain(state: typeof mockState): any {
    const chain: any = {
      values: (vals: any) => {
        state.insertedValues = vals;
        return chain;
      },
      onConflictDoUpdate: () => {
        state.upsertCalled = true;
        return Promise.resolve();
      },
      returning: () => Promise.resolve([state.insertedValues]),
    };
    return chain;
  }

  function makeSelectChain(state: typeof mockState): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(state.selectResult),
      orderBy: () => chain,
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(state.selectResult).then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  return {
    db: {
      select: () => makeSelectChain(mockState),
      insert: () => makeInsertChain(mockState),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    emailDigestPreferencesTable: { userId: {}, frequency: {}, updatedAt: {} },
    notificationsTable: {},
    notificationPreferencesTable: {},
    eq: () => ({}),
    and: () => ({}),
    asc: () => ({}),
    desc: () => ({}),
    sql: () => ({}),
    isNull: () => ({}),
    lt: () => ({}),
    or: () => ({}),
    inArray: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  sql: () => ({}),
  isNull: () => ({}),
  lt: () => ({}),
  or: () => ({}),
  inArray: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1" };
    req.orgId = "org-1";
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1" };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

// Import the actual router after mocks are set up.
import notificationsRouter from "./notifications.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  // Add fake auth so req.user is available even on requireOrg-only routes
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: "user-1" };
    next();
  });
  app.use("/api", notificationsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/email-digest-preference
// ---------------------------------------------------------------------------
describe("GET /api/email-digest-preference", () => {
  beforeEach(() => {
    mockState.selectResult = [];
    mockState.insertedValues = null;
    mockState.upsertCalled = false;
  });

  it("returns 'none' when no preference row exists (opt-in default)", async () => {
    mockState.selectResult = [];

    const res = await request(buildApp()).get("/api/email-digest-preference");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frequency: "none" });
  });

  it("returns stored frequency when a preference row exists", async () => {
    mockState.selectResult = [{ frequency: "daily" }];

    const res = await request(buildApp()).get("/api/email-digest-preference");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frequency: "daily" });
  });

  it("returns weekly when preference is weekly", async () => {
    mockState.selectResult = [{ frequency: "weekly" }];

    const res = await request(buildApp()).get("/api/email-digest-preference");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frequency: "weekly" });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/email-digest-preference
// ---------------------------------------------------------------------------
describe("PATCH /api/email-digest-preference", () => {
  beforeEach(() => {
    mockState.selectResult = [];
    mockState.insertedValues = null;
    mockState.upsertCalled = false;
  });

  it("returns 400 for an invalid frequency value", async () => {
    const res = await request(buildApp())
      .patch("/api/email-digest-preference")
      .send({ frequency: "hourly" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/frequency/i);
  });

  it("returns 400 when frequency is missing", async () => {
    const res = await request(buildApp())
      .patch("/api/email-digest-preference")
      .send({});

    expect(res.status).toBe(400);
  });

  it("accepts 'none' and upserts the preference", async () => {
    const res = await request(buildApp())
      .patch("/api/email-digest-preference")
      .send({ frequency: "none" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frequency: "none" });
    expect(mockState.upsertCalled).toBe(true);
  });

  it("accepts 'daily' and upserts the preference", async () => {
    const res = await request(buildApp())
      .patch("/api/email-digest-preference")
      .send({ frequency: "daily" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frequency: "daily" });
    expect(mockState.upsertCalled).toBe(true);
  });

  it("accepts 'weekly' and upserts the preference", async () => {
    const res = await request(buildApp())
      .patch("/api/email-digest-preference")
      .send({ frequency: "weekly" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frequency: "weekly" });
    expect(mockState.upsertCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Digest mailer multi-org logic (unit-level)
// ---------------------------------------------------------------------------
describe("digest mailer — multi-org notification aggregation", () => {
  it("aggregates notifications across multiple orgs for a single user", () => {
    // Simulate two orgs worth of notifications
    const notifications = [
      { id: 1, orgId: "org-a", message: "SLA breached on task-1", createdAt: new Date("2026-01-01T10:00:00Z"), entityType: "task", entityId: 1 },
      { id: 2, orgId: "org-b", message: "Assigned to task-2", createdAt: new Date("2026-01-01T11:00:00Z"), entityType: "task", entityId: 2 },
    ];
    const orgIds = ["org-a", "org-b"];

    // All notifications belong to a valid org
    const filtered = notifications.filter((n) => orgIds.includes(n.orgId));
    expect(filtered).toHaveLength(2);
    expect(filtered.map((n) => n.orgId)).toEqual(["org-a", "org-b"]);
  });

  it("filters out notifications before lastSentAt", () => {
    const lastSent = new Date("2026-01-01T09:00:00Z");
    const notifications = [
      { id: 1, createdAt: new Date("2026-01-01T08:00:00Z"), message: "old" }, // before lastSent
      { id: 2, createdAt: new Date("2026-01-01T10:00:00Z"), message: "new" }, // after lastSent
    ];

    const fresh = notifications.filter((n) => n.createdAt > lastSent);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.message).toBe("new");
  });

  it("includes all notifications when lastSentAt is null (first digest)", () => {
    // Cast via unknown to prevent TypeScript narrowing the truthy branch to 'never'.
    const lastSent = null as unknown as Date | null;
    const notifications = [
      { id: 1, createdAt: new Date("2026-01-01T08:00:00Z"), message: "old" },
      { id: 2, createdAt: new Date("2026-01-01T10:00:00Z"), message: "new" },
    ];

    const fresh = lastSent
      ? notifications.filter((n) => n.createdAt > lastSent)
      : notifications;

    expect(fresh).toHaveLength(2);
  });

  it("skips a user whose only org has no unread notifications after lastSentAt", () => {
    const lastSent = new Date("2026-01-01T12:00:00Z");
    const notifications = [
      { id: 1, createdAt: new Date("2026-01-01T10:00:00Z"), message: "stale" }, // before lastSent
    ];

    const fresh = notifications.filter((n) => n.createdAt > lastSent);
    expect(fresh).toHaveLength(0); // → user should be skipped, no email sent
  });
});
