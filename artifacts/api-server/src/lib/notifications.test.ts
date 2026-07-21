/**
 * Unit tests for lib/notifications.ts
 *
 * Covered:
 *  - createNotification inserts a row and pushes an SSE event when preferences
 *    allow (no pref row = enabled by default; explicit enabled row = enabled)
 *  - createNotification is a no-op when the user has disabled the notification type
 *  - notifyTaskAssigned fires createNotification for the new assignee
 *  - notifyTaskAssigned skips notification when the actor assigns to themselves
 *  - notifyCommentAdded fires createNotification per recipient, excluding the actor
 *  - notifyCommentAdded is a no-op when the recipient list is empty
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted spies — referenced by vi.mock factories
// ---------------------------------------------------------------------------
const insertSpy = vi.hoisted(() => vi.fn());
const pushEventSpy = vi.hoisted(() => vi.fn());
const selectQueue = vi.hoisted(() => ({ items: [] as any[][] }));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      // limit stays on chain so callers that add .offset() still work;
      // chain itself is thenable so `await .limit(N)` also resolves.
      limit: () => chain,
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
      select: () => makeChain(selectQueue.items.shift() ?? []),
      insert: () => ({
        values: (...args: any[]) => {
          insertSpy(...args);
          return Object.assign(Promise.resolve([]), {
            returning: () => Promise.resolve([]),
            onConflictDoUpdate: () => Object.assign(Promise.resolve([]), {
              returning: () => Promise.resolve([]),
            }),
          });
        },
      }),
    },
    notificationsTable: {},
    notificationPreferencesTable: {},
  };
});

// ---------------------------------------------------------------------------
// Mock ./sse — capture pushEvent calls
// ---------------------------------------------------------------------------
vi.mock("./sse", () => ({
  pushEvent: pushEventSpy,
}));

// ---------------------------------------------------------------------------
// Mock ./logger — suppress noise
// ---------------------------------------------------------------------------
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are registered
// ---------------------------------------------------------------------------
import { createNotification, notifyTaskAssigned, notifyCommentAdded, notifyTaskUpdated } from "./notifications.js";

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------
function reset() {
  selectQueue.items.length = 0;
  insertSpy.mockClear();
  pushEventSpy.mockClear();
}

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

describe("createNotification", () => {
  beforeEach(reset);

  it("inserts a notification row and fires pushEvent when no preference row exists (default enabled)", async () => {
    selectQueue.items.push([]);              // pref lookup → no row → enabled by default
    selectQueue.items.push([{ count: 3 }]); // unread count after insert

    await createNotification({
      userId: "user-1",
      orgId: "org-a",
      type: "task_assigned",
      actorId: "actor-1",
      actorName: "Alice",
      entityType: "task",
      entityId: 42,
      message: 'Alice assigned you to "Fix login bug"',
    });

    // Insert was called once with the expected shape
    expect(insertSpy).toHaveBeenCalledOnce();
    expect(insertSpy.mock.calls[0][0]).toMatchObject({
      userId: "user-1",
      orgId: "org-a",
      type: "task_assigned",
      entityId: 42,
      read: false,
    });

    // SSE push carried the correct unread count and notification type
    expect(pushEventSpy).toHaveBeenCalledWith("user-1", "notification", { unread_count: 3, type: "task_assigned" });
  });

  it("is a no-op when the user has disabled that notification type", async () => {
    selectQueue.items.push([{ enabled: false }]); // pref row → explicitly disabled

    await createNotification({
      userId: "user-1",
      orgId: "org-a",
      type: "task_assigned",
      actorId: "actor-1",
      actorName: "Alice",
      entityType: "task",
      entityId: 42,
      message: 'Alice assigned you to "Fix login bug"',
    });

    // Neither insert nor SSE push should fire
    expect(insertSpy).not.toHaveBeenCalled();
    expect(pushEventSpy).not.toHaveBeenCalled();
  });

  it("inserts and fires pushEvent when the preference row explicitly enables the type", async () => {
    selectQueue.items.push([{ enabled: true }]); // pref row → explicitly enabled
    selectQueue.items.push([{ count: 1 }]);

    await createNotification({
      userId: "user-1",
      orgId: "org-a",
      type: "comment_added",
      actorId: null,
      actorName: null,
      entityType: "task",
      entityId: 7,
      message: 'Someone commented on "Deploy infrastructure"',
    });

    expect(insertSpy).toHaveBeenCalledOnce();
    expect(pushEventSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// notifyTaskAssigned
// ---------------------------------------------------------------------------

describe("notifyTaskAssigned", () => {
  beforeEach(reset);

  it("calls createNotification for the new assignee", async () => {
    selectQueue.items.push([]);              // pref lookup → enabled
    selectQueue.items.push([{ count: 1 }]); // unread count

    await notifyTaskAssigned({
      taskId: 10,
      taskTitle: "Fix login bug",
      orgId: "org-a",
      actorId: "actor-1",
      actorName: "Alice",
      newAssigneeUserId: "user-2",
    });

    expect(insertSpy).toHaveBeenCalledOnce();
    expect(insertSpy.mock.calls[0][0]).toMatchObject({
      userId: "user-2",
      type: "task_assigned",
      entityId: 10,
    });
  });

  it("skips notification when the actor assigns the task to themselves", async () => {
    // actorId === newAssigneeUserId — early return before any DB call
    await notifyTaskAssigned({
      taskId: 10,
      taskTitle: "Fix login bug",
      orgId: "org-a",
      actorId: "user-1",
      actorName: "Alice",
      newAssigneeUserId: "user-1",
    });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(pushEventSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// notifyCommentAdded
// ---------------------------------------------------------------------------

describe("notifyCommentAdded", () => {
  beforeEach(reset);

  it("creates a comment_added notification for each recipient, excluding the actor", async () => {
    // Recipients: user-2 (the actor) and user-3 — only user-3 should be notified.
    selectQueue.items.push([]);              // pref for user-3 → no row → enabled
    selectQueue.items.push([{ count: 1 }]); // unread count for user-3

    await notifyCommentAdded({
      taskId: 5,
      taskTitle: "Outage investigation",
      orgId: "org-a",
      actorId: "user-2",
      actorName: "Bob",
      recipientUserIds: ["user-2", "user-3"],
    });

    // Only one notification inserted — for user-3, not the actor
    expect(insertSpy).toHaveBeenCalledOnce();
    expect(insertSpy.mock.calls[0][0]).toMatchObject({
      userId: "user-3",
      type: "comment_added",
      entityId: 5,
    });
  });

  it("does not create notifications when the recipient list is empty", async () => {
    await notifyCommentAdded({
      taskId: 5,
      taskTitle: "Outage investigation",
      orgId: "org-a",
      actorId: "user-2",
      actorName: "Bob",
      recipientUserIds: [],
    });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(pushEventSpy).not.toHaveBeenCalled();
  });

  it("notifies multiple recipients when none of them are the actor", async () => {
    // Promise.all starts all 3 createNotification calls concurrently.
    // Each call does: (1) pref lookup, (2) insert, (3) unread count.
    // Because all 3 pref lookups are synchronously kicked off before any
    // insert resumes, the actual selectQueue consumption order is:
    //   [pref-A, pref-B, pref-C, count-A, count-B, count-C]
    selectQueue.items.push([], [], []);                                        // 3 pref lookups → all enabled
    selectQueue.items.push([{ count: 1 }], [{ count: 2 }], [{ count: 3 }]);   // 3 unread counts

    await notifyCommentAdded({
      taskId: 9,
      taskTitle: "Deploy prod",
      orgId: "org-a",
      actorId: "external-actor",
      actorName: "CI Bot",
      recipientUserIds: ["user-a", "user-b", "user-c"],
    });

    expect(insertSpy).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// notifyTaskUpdated (#250)
//
// Should dispatch a notification to every recipient EXCEPT the actor.
// ---------------------------------------------------------------------------

describe("notifyTaskUpdated", () => {
  beforeEach(reset);

  it("dispatches to all recipients except the actor", async () => {
    // user-1 = actor, user-2 + user-3 = recipients
    // Each createNotification call: (1) pref lookup, (2) insert, (3) unread count
    selectQueue.items.push([], []);                                  // pref lookups for user-2, user-3
    selectQueue.items.push([{ count: 1 }], [{ count: 2 }]);         // unread counts

    await notifyTaskUpdated({
      taskId: 7,
      taskTitle: "Deploy fix",
      orgId: "org-a",
      actorId: "user-1",
      actorName: "Alice",
      recipientUserIds: ["user-1", "user-2", "user-3"],
      changedField: "status",
      newValue: "done",
    });

    // user-1 (actor) filtered out → 2 inserts
    expect(insertSpy).toHaveBeenCalledTimes(2);
    const recipientIds = insertSpy.mock.calls.map((c: any[]) => c[0].userId);
    expect(recipientIds).toContain("user-2");
    expect(recipientIds).toContain("user-3");
    expect(recipientIds).not.toContain("user-1");
  });

  it("does not dispatch any notification when the recipient list is empty", async () => {
    await notifyTaskUpdated({
      taskId: 8,
      taskTitle: "Empty task",
      orgId: "org-b",
      actorId: "user-x",
      actorName: "X",
      recipientUserIds: [],
      changedField: "priority",
      newValue: "high",
    });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(pushEventSpy).not.toHaveBeenCalled();
  });

  it("does not dispatch when the only recipient IS the actor", async () => {
    await notifyTaskUpdated({
      taskId: 9,
      taskTitle: "Self-assign task",
      orgId: "org-a",
      actorId: "user-solo",
      actorName: "Solo",
      recipientUserIds: ["user-solo"],
      changedField: "assignee",
      newValue: "user-solo",
    });

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("includes the changed field and new value in the notification message", async () => {
    selectQueue.items.push([]);            // pref lookup
    selectQueue.items.push([{ count: 0 }]); // unread count

    await notifyTaskUpdated({
      taskId: 10,
      taskTitle: "API outage",
      orgId: "org-a",
      actorId: "user-a",
      actorName: "Bob",
      recipientUserIds: ["user-b"],
      changedField: "status",
      newValue: "resolved",
    });

    expect(insertSpy).toHaveBeenCalledOnce();
    const insertArg = insertSpy.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      userId: "user-b",
      type: "task_updated",
      entityId: 10,
    });
    expect(insertArg.message).toContain("status");
    expect(insertArg.message).toContain("resolved");
    expect(insertArg.message).toContain("API outage");
  });
});

