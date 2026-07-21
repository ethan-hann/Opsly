/**
 * Tests for comments routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered regressions:
 *  - GET /tasks/:id/comments — org-scoping (task must belong to org), 404 on miss
 *  - POST /tasks/:id/comments — org-scoping, body validation, 201 on success
 *  - PATCH /comments/:id — ownership-or-edit_comments gate, body validation, 200 on success,
 *      editedAt is a proper ISO string in the response; list-comments also serializes editedAt correctly
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
    req.orgPermissions = {
      manage_projects: mockState.manageOrgSettings,
      delete_comments: mockState.manageOrgSettings,
      edit_comments: mockState.manageOrgSettings,
    };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "test-org";
    req.user = { id: mockState.currentUserId };
    req.orgPermissions = {
      manage_projects: mockState.manageOrgSettings,
      delete_comments: mockState.manageOrgSettings,
      edit_comments: mockState.manageOrgSettings,
    };
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

  it("returns 404 when the parentId belongs to a comment on a different task (same org)", async () => {
    // The route validates parentId with AND(commentId, taskId, orgId).
    // A comment that exists on task 2 will not match task 1's query, so the
    // DB returns no rows and the handler must respond with 404.
    mockState.selectQueue.push([MOCK_TASK]); // task 1 found
    mockState.selectQueue.push([]);          // parent lookup: comment belongs to task 2, not task 1

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Cross-task reply attempt", parentId: 42 });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the parentId belongs to a comment on a different org", async () => {
    // The route validates parentId with AND(commentId, taskId, orgId).
    // A comment from a different org will not match the caller's orgId,
    // so the DB returns no rows and the handler must respond with 404.
    mockState.selectQueue.push([MOCK_TASK]); // task found in caller's org
    mockState.selectQueue.push([]);          // parent lookup: comment belongs to a different org

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Cross-org reply attempt", parentId: 99 });

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
// PATCH /api/comments/:id
// ---------------------------------------------------------------------------

describe("PATCH /api/comments/:id", () => {
  const MOCK_EDITED_COMMENT = {
    ...MOCK_COMMENT,
    content: "Updated content",
    editedAt: new Date("2024-06-01T12:00:00.000Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateResult = [];
    mockState.currentUserId = "user-1";
    mockState.manageOrgSettings = false;
  });

  it("returns 404 when the comment does not exist", async () => {
    mockState.selectQueue.push([]); // comment not found

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({ content: "Updated content" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when content is missing", async () => {
    mockState.selectQueue.push([MOCK_COMMENT]); // comment found

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when content is an empty string", async () => {
    mockState.selectQueue.push([MOCK_COMMENT]);

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({ content: "" });

    expect(res.status).toBe(400);
  });

  it("returns 200 with updated content when the caller is the comment author", async () => {
    // currentUserId === MOCK_COMMENT.userId ("user-1")
    mockState.selectQueue.push([MOCK_COMMENT]);         // comment found
    mockState.updateResult = [MOCK_EDITED_COMMENT];     // update succeeds
    mockState.selectQueue.push([]);                     // reactions enrichment (empty)

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({ content: "Updated content" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, content: "Updated content" });
    // editedAt must be an ISO string, not a Date object
    expect(typeof res.body.editedAt).toBe("string");
    expect(res.body.editedAt).toBe("2024-06-01T12:00:00.000Z");
  });

  it("returns 403 when the caller is not the author and lacks edit_comments permission", async () => {
    mockState.currentUserId = "user-2";
    mockState.manageOrgSettings = false;
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: "user-1" }]);

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({ content: "Updated content" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 200 when the caller has edit_comments permission and edits another user's comment", async () => {
    mockState.currentUserId = "admin-user";
    mockState.manageOrgSettings = true;
    mockState.selectQueue.push([{ ...MOCK_COMMENT, userId: "user-1" }]); // different userId
    mockState.updateResult = [{ ...MOCK_EDITED_COMMENT, userId: "user-1" }];
    mockState.selectQueue.push([]); // reactions enrichment

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({ content: "Updated content" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ content: "Updated content" });
    expect(typeof res.body.editedAt).toBe("string");
  });

  it("returns 404 when the comment is soft-deleted", async () => {
    // The route queries with isNull(deletedAt), so a soft-deleted row is
    // invisible to the handler — it sees no rows and responds with 404.
    mockState.selectQueue.push([]); // soft-deleted comment excluded by DB predicate

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({ content: "Updated content" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the comment belongs to a different org", async () => {
    // The route queries with eq(orgId), so a comment from another org
    // is invisible to the caller — the handler responds with 404.
    mockState.selectQueue.push([]); // cross-org comment excluded by DB predicate

    const res = await request(buildApp())
      .patch("/api/comments/1")
      .send({ content: "Updated content" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-integer comment id", async () => {
    const res = await request(buildApp())
      .patch("/api/comments/bad-id")
      .send({ content: "Updated content" });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// editedAt serialization in GET /api/tasks/:id/comments
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/comments — editedAt serialization", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("serializes editedAt as an ISO string when the comment has been edited", async () => {
    const editedComment = {
      ...MOCK_COMMENT,
      editedAt: new Date("2024-06-01T10:00:00.000Z"),
      deletedAt: null,
    };
    mockState.selectQueue.push([MOCK_TASK]);      // task found
    mockState.selectQueue.push([editedComment]);  // one edited comment
    mockState.selectQueue.push([]);               // reactions enrichment

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(typeof res.body[0].editedAt).toBe("string");
    expect(res.body[0].editedAt).toBe("2024-06-01T10:00:00.000Z");
  });

  it("returns null for editedAt when the comment has not been edited", async () => {
    const uneditedComment = { ...MOCK_COMMENT, editedAt: null, deletedAt: null };
    mockState.selectQueue.push([MOCK_TASK]);
    mockState.selectQueue.push([uneditedComment]);
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/tasks/1/comments");

    expect(res.status).toBe(200);
    expect(res.body[0].editedAt).toBeNull();
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

// ---------------------------------------------------------------------------
// Notification spies — hoisted so vi.mock factory can reference them.
// These only affect tests that explicitly await vi.waitFor; other tests are
// unaffected because they don't assert on notification behaviour.
// ---------------------------------------------------------------------------
const notificationSpies = vi.hoisted(() => ({
  mentions: vi.fn().mockResolvedValue(undefined),
  commentAdded: vi.fn().mockResolvedValue(undefined),
  commentReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notifications", () => ({
  notifyMentions: notificationSpies.mentions,
  notifyCommentAdded: notificationSpies.commentAdded,
  notifyCommentReply: notificationSpies.commentReply,
  notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
  notifyTaskUpdated: vi.fn().mockResolvedValue(undefined),
  notifySlaBreached: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/comments — soft-deleted parent guard (#355)
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/comments — soft-deleted parent guard", () => {
  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.insertResult = [];
    notificationSpies.mentions.mockClear();
    notificationSpies.commentAdded.mockClear();
  });

  it("returns 404 when parentId points to a soft-deleted comment", async () => {
    // selectQueue[0]: task found; selectQueue[1]: parent query returns empty (isNull check)
    mockState.selectQueue.push([{ id: 1 }]);
    mockState.selectQueue.push([]); // parent not found because deletedAt IS NOT NULL

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "reply to deleted", parentId: 99 });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: /[Pp]arent/ });
  });

  it("returns 201 when parentId points to a live (non-deleted) comment", async () => {
    mockState.selectQueue.push([{ id: 1 }]);                       // task found
    mockState.selectQueue.push([{ id: 99, userId: "user-2" }]);    // parent live ✓
    mockState.insertResult = [{
      id: 5, taskId: 1, orgId: "test-org", userId: "user-1",
      content: "reply", parentId: 99, author: null,
      createdAt: new Date(), editedAt: null, deletedAt: null,
    }];

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "reply", parentId: 99 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ content: "reply", parentId: 99 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/comments — mention de-duplication (#310)
//
// When a user is @-mentioned AND is a watcher, they should receive a mention
// notification but NOT a duplicate watcher notification.
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/comments — mention de-duplication", () => {
  const FULL_TASK = {
    id: 1, orgId: "test-org", orgTaskNumber: 1, title: "My Task",
    status: "open", priority: "medium", projectId: null,
    assignee: null, dueDate: null, category: null, description: null,
    customFields: {}, slaBreachedAt: null, slaWarningSentAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  };

  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.insertResult = [];
    mockState.currentUserId = "user-actor";
    notificationSpies.mentions.mockClear();
    notificationSpies.commentAdded.mockClear();
  });

  it("calls notifyMentions once and skips notifyCommentAdded for the mentioned watcher", async () => {
    // Queued in order the route's async IIFE consumes them:
    //  [0] task (sync scope)
    //  [1] fullTask (IIFE)
    //  [2] customFieldDefs for resolveCustomFieldNames
    //  [3] orgMembers — user-3 is active
    //  [4] taskWatchers — user-3 is also a watcher → must be deduplicated
    mockState.selectQueue.push([{ id: 1 }]);                                  // sync: task lookup
    mockState.selectQueue.push([FULL_TASK]);                                   // IIFE: fullTask
    mockState.selectQueue.push([]);                                            // IIFE: customFieldDefs
    mockState.selectQueue.push([{ userId: "user-3" }]);                       // IIFE: orgMembers
    mockState.selectQueue.push([{ userId: "user-3" }]);                       // IIFE: taskWatchers

    mockState.insertResult = [{
      id: 10, taskId: 1, orgId: "test-org", userId: "user-actor",
      content: "hey @[user-3:Charlie]", parentId: null, author: null,
      createdAt: new Date(), editedAt: null, deletedAt: null,
    }];

    await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "hey @[user-3:Charlie]" });

    // Give the fire-and-forget IIFE time to complete
    await vi.waitFor(() => {
      expect(notificationSpies.mentions).toHaveBeenCalledOnce();
    });

    // user-3 was mentioned — must NOT also receive a watcher notification
    expect(notificationSpies.commentAdded).not.toHaveBeenCalled();
    expect(notificationSpies.mentions.mock.calls[0][0]).toMatchObject({
      recipientUserIds: ["user-3"],
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/comments — @everyone active-member scoping (#311)
//
// @[everyone] should notify only users present in orgMembersTable.
// Pending invites and removed members have no orgMember row and are excluded.
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/comments — @everyone active-only", () => {
  const FULL_TASK = {
    id: 1, orgId: "test-org", orgTaskNumber: 1, title: "Incident",
    status: "open", priority: "high", projectId: null,
    assignee: null, dueDate: null, category: null, description: null,
    customFields: {}, slaBreachedAt: null, slaWarningSentAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  };

  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.insertResult = [];
    mockState.currentUserId = "user-actor";
    notificationSpies.mentions.mockClear();
    notificationSpies.commentAdded.mockClear();
  });

  it("notifies only orgMember rows — pending-invite and removed users are excluded", async () => {
    // orgMembers returns ONLY the two active users.
    // "pending-invite-user" and "removed-user" are NOT in this result
    // because they have no orgMember row in a real DB.
    mockState.selectQueue.push([{ id: 1 }]);                          // task
    mockState.selectQueue.push([FULL_TASK]);                           // fullTask
    mockState.selectQueue.push([]);                                    // customFieldDefs
    mockState.selectQueue.push([                                       // orgMembers
      { userId: "active-1" },
      { userId: "active-2" },
    ]);
    mockState.selectQueue.push([]);                                    // taskWatchers

    mockState.insertResult = [{
      id: 11, taskId: 1, orgId: "test-org", userId: "user-actor",
      content: "@[everyone]", parentId: null, author: null,
      createdAt: new Date(), editedAt: null, deletedAt: null,
    }];

    await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "@[everyone]" });

    await vi.waitFor(() => {
      expect(notificationSpies.mentions).toHaveBeenCalledOnce();
    });

    const { recipientUserIds } = notificationSpies.mentions.mock.calls[0][0];
    // Only the two active members — not the actor, not pending/removed
    expect(recipientUserIds).toContain("active-1");
    expect(recipientUserIds).toContain("active-2");
    expect(recipientUserIds).not.toContain("user-actor");
    expect(recipientUserIds).not.toContain("pending-invite-user");
    expect(recipientUserIds).not.toContain("removed-user");
  });
});
