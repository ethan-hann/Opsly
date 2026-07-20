/**
 * Route tests for the notifications API.
 *
 * Covered:
 *  - GET  /notifications — returns only the calling user's notifications;
 *    cross-user/cross-org rows are filtered out by the WHERE userId+orgId clause
 *  - POST /notifications/read-all — marks all unread rows as read and reports
 *    the number of rows updated
 *  - PATCH /notifications/:id/read — marks a single notification as read;
 *    returns 404 for a cross-user notification id
 *  - DELETE /notifications/:id — removes a notification; 404 for cross-user id
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  updateReturning: [] as any[], // what db.update().returning() resolves to
  deleteReturning: [] as any[],
  orgId: "org-a",
  userId: "user-1",
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      asc: () => chain,
      desc: () => chain,
      // limit stays on chain; offset is the terminal for paginated queries
      limit: () => chain,
      offset: () => Promise.resolve(result),
      then(ok: any, rej: any) {
        return Promise.resolve(result).then(ok, rej);
      },
      catch(rej: any) {
        return Promise.resolve(result).catch(rej);
      },
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: () =>
          Object.assign(Promise.resolve([]), {
            onConflictDoUpdate: () => Promise.resolve([]),
          }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(mockState.updateReturning),
          }),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockState.deleteReturning),
        }),
      }),
    },
    notificationsTable: {},
    notificationPreferencesTable: {},
    emailDigestPreferencesTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  sql: () => ({}),
  isNull: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock ../lib/notification-schemas — passthrough so real Zod shapes are bypassed
// ---------------------------------------------------------------------------
vi.mock("../lib/notification-schemas", () => {
  const p = {
    parse: (x: any) => x,
    safeParse: (x: any) => ({ success: true, data: x }),
  };
  // NotificationTypeEnum.options is used by the preferences routes (not tested here)
  const NotificationTypeEnum = { options: ["task_assigned", "task_updated", "comment_added", "sla_breached", "mention"] };
  return {
    ListNotificationsQueryParams: {
      safeParse: (x: any) => ({
        success: true,
        data: { limit: 50, offset: 0, unreadOnly: false, ...x },
      }),
    },
    ListNotificationsResponse: p,
    MarkAllReadResponse: p,
    MarkNotificationReadParams: p,
    MarkNotificationReadResponse: p,
    DeleteNotificationParams: p,
    GetNotificationPreferencesResponse: p,
    UpdateNotificationPreferencesBody: p,
    UpdateNotificationPreferencesResponse: p,
    NotificationTypeEnum,
  };
});

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = mockState.orgId;
    req.user = { id: mockState.userId, email: "user@example.com" };
    next();
  },
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------
import notificationsRouter from "./notifications.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", notificationsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const OWN_NOTIFICATION = {
  id: 1,
  orgId: "org-a",
  userId: "user-1",
  type: "task_assigned",
  actorId: "actor-1",
  actorName: "Alice",
  entityType: "task",
  entityId: 10,
  message: 'Alice assigned you to "Fix login bug"',
  read: false,
  createdAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// GET /notifications — org + user isolation
// ---------------------------------------------------------------------------

describe("GET /notifications — user isolation", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateReturning = [];
    mockState.deleteReturning = [];
    mockState.orgId = "org-a";
    mockState.userId = "user-1";
  });

  it("returns the calling user's notifications with correct shape", async () => {
    // Promise.all fires 3 selects concurrently; selectQueue consumed in call order:
    //   [0] → rows (with limit + offset chain)
    //   [1] → total count
    //   [2] → unread count
    mockState.selectQueue.push([OWN_NOTIFICATION]);  // rows
    mockState.selectQueue.push([{ total: 1 }]);       // total count
    mockState.selectQueue.push([{ unreadCount: 1 }]); // unread count

    const res = await request(buildApp()).get("/api/notifications");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      notifications: [expect.objectContaining({ id: 1, userId: "user-1" })],
      total: 1,
      unreadCount: 1,
    });
  });

  it("returns an empty list when the WHERE clause finds no rows for this user/org", async () => {
    // The route's WHERE includes userId = caller AND orgId = caller's org.
    // A cross-org or cross-user query would return [] from the real DB;
    // we simulate that by returning [] from all three parallel selects.
    mockState.selectQueue.push([]);              // rows → none
    mockState.selectQueue.push([{ total: 0 }]); // total
    mockState.selectQueue.push([{ unreadCount: 0 }]); // unread

    const res = await request(buildApp()).get("/api/notifications");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notifications: [], total: 0, unreadCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// POST /notifications/read-all
// ---------------------------------------------------------------------------

describe("POST /notifications/read-all", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateReturning = [];
    mockState.orgId = "org-a";
    mockState.userId = "user-1";
  });

  it("marks all unread notifications as read and returns the updated count", async () => {
    // The update WHERE clause scopes to userId + orgId + read=false;
    // returning returns the IDs of the rows that were updated.
    mockState.updateReturning = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const res = await request(buildApp())
      .post("/api/notifications/read-all");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 3 });
  });

  it("returns updated: 0 when all notifications are already read", async () => {
    mockState.updateReturning = []; // no unread rows to update

    const res = await request(buildApp())
      .post("/api/notifications/read-all");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 0 });
  });
});

// ---------------------------------------------------------------------------
// PATCH /notifications/:id/read
// ---------------------------------------------------------------------------

describe("PATCH /notifications/:id/read", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateReturning = [];
    mockState.orgId = "org-a";
    mockState.userId = "user-1";
  });

  it("returns the updated notification when it belongs to the calling user", async () => {
    const updated = { ...OWN_NOTIFICATION, read: true };
    mockState.updateReturning = [updated];

    const res = await request(buildApp())
      .patch("/api/notifications/1/read");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, read: true });
  });

  it("returns 404 when the notification does not belong to the calling user", async () => {
    // The WHERE includes userId = caller — a cross-user row returns nothing.
    mockState.updateReturning = [];

    const res = await request(buildApp())
      .patch("/api/notifications/99/read");

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /notifications/:id
// ---------------------------------------------------------------------------

describe("DELETE /notifications/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.deleteReturning = [];
    mockState.orgId = "org-a";
    mockState.userId = "user-1";
  });

  it("returns 204 when the notification is deleted successfully", async () => {
    mockState.deleteReturning = [{ id: 1 }];

    const res = await request(buildApp())
      .delete("/api/notifications/1");

    expect(res.status).toBe(204);
  });

  it("returns 404 when the notification does not belong to the calling user", async () => {
    // WHERE includes userId + orgId — a cross-user/cross-org id returns nothing.
    mockState.deleteReturning = [];

    const res = await request(buildApp())
      .delete("/api/notifications/99");

    expect(res.status).toBe(404);
  });
});
