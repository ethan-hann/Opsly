/**
 * Tests for comments routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered regressions:
 *  - GET /tasks/:id/comments — org-scoping (task must belong to org), 404 on miss
 *  - POST /tasks/:id/comments — org-scoping, body validation, 201 on success
 *  - DELETE /comments/:id — org-scoped select (permission check) + DELETE WHERE id AND org_id
 *      to prevent cross-org race; 404 on miss/mismatch, 403 on insufficient permission, 204 on success
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertResult: [] as any[],
  deleteResult: [] as any[],
  updateResult: [] as any[], // used by soft-delete (db.update)
  currentUserId: "user-1",
  manageOrgSettings: false,
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
      limit: () => Promise.resolve(result),
      orderBy: () => Promise.resolve(result),
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
          onConflictDoNothing: () => Promise.resolve([]),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockState.deleteResult),
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
    commentsTable: {},
    tasksTable: {},
    orgMembersTable: {},
    projectsTable: {},
    notesTable: {},
    usersTable: {},
    workflowStagesTable: {},
    commentReactionsTable: {},
    organizationsTable: {},
    taskWatchersTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
  inArray: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: mockState.currentUserId };
    req.orgPermissions = { manage_projects: mockState.manageOrgSettings, delete_comments: mockState.manageOrgSettings };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: mockState.currentUserId };
    req.orgPermissions = { manage_projects: mockState.manageOrgSettings, delete_comments: mockState.manageOrgSettings };
    next();
  },
}));

import commentsRouter from "./comments.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", commentsRouter);
  return app;
}

const MOCK_TASK = { id: 1 };

const MOCK_COMMENT = {
  id: 1,
  taskId: 1,
  orgId: "test-org",
  parentId: null,
  content: "Looks good to me",
  author: "alice@example.com",
  userId: "user-1", // matches mockState.currentUserId default
  createdAt: "2024-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/comments
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/comments", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
  });

  it("returns 404 when the task does not belong to the org", async () => {
    // Task lookup returns empty - task not found in this org.
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 200 with an empty array when the task has no comments", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task found
    mockState.selectQueue.push([]);           // no comments

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with the comment list when comments exist", async () => {
    mockState.selectQueue.push([MOCK_TASK]);        // task found
    mockState.selectQueue.push([MOCK_COMMENT]);     // one comment
    mockState.selectQueue.push([]);                 // reactions enrichment (empty)

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 1,
      taskId: 1,
      content: "Looks good to me",
    });
  });

  it("returns 400 for a non-integer task id", async () => {
    const res = await request(buildApp()).get("/api/tasks/not-a-number/comments");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/comments
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/comments", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
  });

  it("returns 404 when the task does not belong to the org", async () => {
    mockState.selectQueue.push([]); // task not found

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Hello" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when content is missing", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task found

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when content is an empty string", async () => {
    mockState.selectQueue.push([MOCK_TASK]);

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "" });

    expect(res.status).toBe(400);
  });

  it("returns 201 with the created comment on success", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task found
    mockState.insertResult = [MOCK_COMMENT];

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Looks good to me", author: "alice@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 1,
      taskId: 1,
      content: "Looks good to me",
      author: "alice@example.com",
    });
  });

  it("returns 404 when the parentId refers to a comment not in this task/org", async () => {
    mockState.selectQueue.push([MOCK_TASK]); // task found
    mockState.selectQueue.push([]);          // parent comment not found

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Reply to missing comment", parentId: 999 });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 201 with parentId set when replying to an existing comment", async () => {
    const MOCK_REPLY = { ...MOCK_COMMENT, id: 2, parentId: 1, content: "This is a reply" };
    mockState.selectQueue.push([MOCK_TASK]);    // task found
    mockState.selectQueue.push([MOCK_COMMENT]); // parent comment found
    mockState.insertResult = [MOCK_REPLY];

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "This is a reply", parentId: 1 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 2, parentId: 1, content: "This is a reply" });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/comments/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/comments/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.deleteResult = [{ id: 1 }];
    mockState.updateResult = [{ id: 1 }]; // default: soft-delete UPDATE RETURNING succeeds
    mockState.currentUserId = "user-1";
    mockState.manageOrgSettings = false;
  });

  it("returns 404 when the comment does not exist", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(404);
  });

  it("returns 404 when the comment's org_id does not match the caller's org", async () => {
    // The combined (id AND orgId) query returns no rows when org doesn't match
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(404);
  });

  it("returns 204 when the caller is the comment author", async () => {
    // userId matches currentUserId — author deleting their own comment
    mockState.selectQueue.push([MOCK_COMMENT]); // userId: "user-1"

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(204);
  });

  it("returns 403 when the caller is not the author and not an admin", async () => {
    mockState.currentUserId = "user-2"; // different user
    mockState.manageOrgSettings = false;
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: "user-1" }]);

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(403);
  });

  it("returns 204 when the caller is an org admin deleting another user's comment", async () => {
    mockState.currentUserId = "admin-user";
    mockState.manageOrgSettings = true;
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: "user-1" }]); // comment by different user

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(204);
  });

  it("returns 204 when the caller is an admin deleting a legacy comment with no userId", async () => {
    mockState.currentUserId = "admin-user";
    mockState.manageOrgSettings = true;
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: null }]);

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(204);
  });

  it("returns 403 when a non-admin tries to delete a legacy comment with no userId", async () => {
    mockState.currentUserId = "user-2";
    mockState.manageOrgSettings = false;
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: null }]);

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the comment was soft-deleted by a concurrent request between SELECT and UPDATE", async () => {
    // SELECT finds the comment (author matches), but the UPDATE RETURNING comes back empty —
    // simulating a same-org race where another request soft-deleted the row first.
    mockState.selectQueue.push([MOCK_COMMENT]); // SELECT succeeds: author owns comment
    mockState.updateResult = [];                 // UPDATE RETURNING: no row updated (already deleted)

    const res = await request(buildApp()).delete("/api/comments/1");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-integer comment id", async () => {
    const res = await request(buildApp()).delete("/api/comments/bad-id");
    expect(res.status).toBe(400);
  });
});
