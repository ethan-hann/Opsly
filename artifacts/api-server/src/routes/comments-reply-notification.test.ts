/**
 * Integration tests verifying that posting a reply notifies the parent
 * comment's author via notifyCommentReply.
 *
 * The notifications module is mocked so we can assert the helper is called
 * with correct arguments without touching the DB or SSE infrastructure.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Notification spy — must be hoisted before vi.mock calls
// ---------------------------------------------------------------------------
const notifyCommentReplySpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const notifyCommentAddedSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const notifyMentionsSpy    = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../lib/notifications", () => ({
  notifyCommentAdded: notifyCommentAddedSpy,
  notifyMentions:    notifyMentionsSpy,
  notifyCommentReply: notifyCommentReplySpy,
}));

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertResult: [] as any[],
  currentUserId: "user-replier",
}));

// ---------------------------------------------------------------------------
// @workspace/db mock
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      limit: () => Promise.resolve(result),
      orderBy: () => Promise.resolve(result),
      then(ok: any, rej: any) { return Promise.resolve(result).then(ok, rej); },
      catch(rej: any)         { return Promise.resolve(result).catch(rej); },
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
      delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    },
    commentsTable:         {},
    tasksTable:            {},
    orgMembersTable:       {},
    projectsTable:         {},
    notesTable:            {},
    usersTable:            {},
    workflowStagesTable:   {},
    commentReactionsTable: {},
    organizationsTable:    {},
    taskWatchersTable:     {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}), and: () => ({}), or: () => ({}),
  isNull: () => ({}), sql: () => ({}), inArray: () => ({}),
}));

vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: () => false,
  requireScope: () => (_: any, __: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _: any, next: any) => {
    req.orgId = "test-org";
    req.user  = { id: mockState.currentUserId };
    req.orgPermissions = {};
    next();
  },
  requireOrg: (req: any, _: any, next: any) => {
    req.orgId = "test-org";
    req.user  = { id: mockState.currentUserId };
    req.orgPermissions = {};
    next();
  },
}));

// webhook-dispatcher must be stubbed (imported transitively)
vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchTaskCommented: vi.fn(),
}));

// resolve-custom-fields is called in the async block
vi.mock("../lib/resolve-custom-fields", () => ({
  resolveCustomFieldNames: vi.fn().mockResolvedValue({}),
}));

import commentsRouter from "./comments.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", commentsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_TASK = {
  id: 1,
  orgId: "test-org",
  title: "Fix login bug",
  projectId: null,
  customFields: {},
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

const PARENT_COMMENT = {
  id: 10,
  taskId: 1,
  orgId: "test-org",
  content: "Original comment",
  author: "alice@example.com",
  userId: "user-alice",   // parent author — different from replier
  parentId: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
  editedAt: null,
};

const REPLY_COMMENT = {
  id: 11,
  taskId: 1,
  orgId: "test-org",
  content: "Great point!",
  author: "bob@example.com",
  userId: "user-replier",
  parentId: 10,
  createdAt: "2024-01-02T00:00:00.000Z",
  deletedAt: null,
  editedAt: null,
};

// ---------------------------------------------------------------------------
// Helper: drain the microtask/promise queue so the fire-and-forget block runs
// ---------------------------------------------------------------------------
const flushAsync = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/comments — reply notifications", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertResult = [];
    mockState.currentUserId = "user-replier";
    notifyCommentReplySpy.mockClear();
    notifyCommentAddedSpy.mockClear();
    notifyMentionsSpy.mockClear();
  });

  it("calls notifyCommentReply with the parent author when a reply is posted", async () => {
    // Synchronous route path:
    mockState.selectQueue.push([{ id: 1 }]);           // task found
    mockState.selectQueue.push([PARENT_COMMENT]);       // parent comment found (includes userId)
    mockState.insertResult = [REPLY_COMMENT];

    // Async notification block:
    mockState.selectQueue.push([MOCK_TASK]);   // fullTask re-fetch
    mockState.selectQueue.push([]);            // watcher rows (none)

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Great point!", parentId: 10 });

    expect(res.status).toBe(201);

    await flushAsync();

    expect(notifyCommentReplySpy).toHaveBeenCalledOnce();
    expect(notifyCommentReplySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId:          MOCK_TASK.id,
        taskTitle:       MOCK_TASK.title,
        orgId:           "test-org",
        recipientUserId: PARENT_COMMENT.userId,
      }),
    );
  });

  it("does NOT call notifyCommentReply for a top-level comment (no parentId)", async () => {
    const TOP_LEVEL = { ...REPLY_COMMENT, id: 20, parentId: null };

    mockState.selectQueue.push([{ id: 1 }]); // task found
    mockState.insertResult = [TOP_LEVEL];

    // Async block
    mockState.selectQueue.push([MOCK_TASK]);
    mockState.selectQueue.push([]); // watchers

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Top-level comment" });

    expect(res.status).toBe(201);

    await flushAsync();

    expect(notifyCommentReplySpy).not.toHaveBeenCalled();
  });

  it("does NOT call notifyCommentReply when the replier is the same user as the parent author", async () => {
    // Self-reply: replier userId === parent userId
    mockState.currentUserId = "user-alice";
    const SELF_PARENT = { ...PARENT_COMMENT, userId: "user-alice" };
    const SELF_REPLY  = { ...REPLY_COMMENT, userId: "user-alice", parentId: 10 };

    mockState.selectQueue.push([{ id: 1 }]);   // task found
    mockState.selectQueue.push([SELF_PARENT]);  // parent found (same userId as replier)
    mockState.insertResult = [SELF_REPLY];

    // Async block
    mockState.selectQueue.push([MOCK_TASK]);
    mockState.selectQueue.push([]); // watchers

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "My own follow-up", parentId: 10 });

    expect(res.status).toBe(201);

    await flushAsync();

    expect(notifyCommentReplySpy).not.toHaveBeenCalled();
  });

  it("does NOT call notifyCommentReply when the parent comment has no userId (legacy comment)", async () => {
    const LEGACY_PARENT = { ...PARENT_COMMENT, userId: null };

    mockState.selectQueue.push([{ id: 1 }]);     // task found
    mockState.selectQueue.push([LEGACY_PARENT]); // parent found (no userId)
    mockState.insertResult = [REPLY_COMMENT];

    // Async block
    mockState.selectQueue.push([MOCK_TASK]);
    mockState.selectQueue.push([]); // watchers

    const res = await request(buildApp())
      .post("/api/tasks/1/comments")
      .send({ content: "Reply to legacy comment", parentId: 10 });

    expect(res.status).toBe(201);

    await flushAsync();

    // parentCommentUserId is null — no notification should fire
    expect(notifyCommentReplySpy).not.toHaveBeenCalled();
  });
});
