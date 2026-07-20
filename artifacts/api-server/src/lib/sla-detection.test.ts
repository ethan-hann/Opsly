/**
 * Unit tests for sla-detection — breach email and in-app notification paths.
 *
 * Covered:
 *  - detectAndMarkSlaBreaches fires notifySlaBreached (in-app) when a task breaches
 *  - detectAndMarkSlaBreaches calls sendMail with the breach email when SMTP is configured
 *  - detectAndMarkSlaBreaches does NOT call sendMail when SMTP is not configured
 *  - detectAndMarkSlaBreaches is a no-op when no tasks are candidates (already breached)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock spies — hoisted so the vi.mock factory can reference them
// ---------------------------------------------------------------------------
const sendMailSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const isEmailConfiguredMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const notifySlaBreachedSpy = vi.hoisted(() => vi.fn());
const dispatchTaskSlaBreachedSpy = vi.hoisted(() => vi.fn());

// Queue-based DB select results consumed in call order
const selectQueue = vi.hoisted(() => ({ items: [] as any[][] }));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function chain(result: any[]): any {
    const c: any = {
      from: () => c,
      where: () => c,
      innerJoin: () => c,
      limit: () => Promise.resolve(result),
      then: (ok: any, rej: any) => Promise.resolve(result).then(ok, rej),
      catch: (rej: any) => Promise.resolve(result).catch(rej),
    };
    return c;
  }

  return {
    db: {
      select: () => chain(selectQueue.items.shift() ?? []),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([{ id: 1 }]),
          }),
        }),
      }),
      insert: () => ({
        values: () =>
          Object.assign(Promise.resolve([]), {
            returning: () => Promise.resolve([]),
          }),
      }),
    },
    tasksTable: {},
    slaPoliciesTable: {},
    workflowStagesTable: {},
    taskEventsTable: {},
    orgMembersTable: {},
    usersTable: {},
    organizationsTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------
vi.mock("./email", () => ({
  sendMail: sendMailSpy,
  isEmailConfigured: isEmailConfiguredMock,
  buildSlaBreachEmail: vi.fn().mockReturnValue("<html>breach</html>"),
}));

vi.mock("./notifications", () => ({
  notifySlaBreached: notifySlaBreachedSpy,
}));

vi.mock("./webhook-dispatcher", () => ({
  dispatchTaskSlaBreached: dispatchTaskSlaBreachedSpy,
  dispatchSlaWarning: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("./sla", () => ({
  getSlaStatus: vi.fn().mockReturnValue({
    isResolutionBreached: true,
    responseStatus: "ok",
    resolutionMinutesRemaining: -30,
    responseMinutesRemaining: null,
  }),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are registered
// ---------------------------------------------------------------------------
import { detectAndMarkSlaBreaches } from "./sla-detection.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const BASE_TASK = {
  id: 1,
  orgId: "test-org",
  orgTaskNumber: 1,
  title: "Fix the login bug",
  status: "open",         // legacy string status — "open" is treated as open
  priority: "high" as const,
  assignee: "assignee@example.com",
  slaBreachedAt: null,
  slaWarningSentAt: null,
  projectId: null,
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
};

const POLICY = {
  id: 1,
  orgId: "test-org",
  projectId: null,
  priority: "high",
  responseMinutes: 60,
  resolutionMinutes: 120,
  warningThresholdPercent: 80,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function reset() {
  selectQueue.items.length = 0;
  sendMailSpy.mockClear();
  notifySlaBreachedSpy.mockClear();
  dispatchTaskSlaBreachedSpy.mockClear();
  isEmailConfiguredMock.mockReturnValue(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectAndMarkSlaBreaches — breach email delivery", () => {
  beforeEach(reset);

  it("calls notifySlaBreached (in-app) when a task breaches and has an assignee", async () => {
    // The assignee lookup returns a real member row
    selectQueue.items.push([{ userId: "user-a", email: "assignee@example.com" }]);

    await detectAndMarkSlaBreaches([BASE_TASK] as any, "test-org", [POLICY] as any);

    // Flush the fire-and-forget IIFE (one async DB call before notifySlaBreached)
    await vi.waitFor(() => {
      expect(notifySlaBreachedSpy).toHaveBeenCalledOnce();
    });

    expect(notifySlaBreachedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: BASE_TASK.id,
        taskTitle: BASE_TASK.title,
        orgId: "test-org",
        recipientUserIds: ["user-a"],
      }),
    );
  });

  it("calls sendMail with the breach email when SMTP is configured", async () => {
    isEmailConfiguredMock.mockReturnValue(true);

    // Assignee lookup, then org name lookup for the email
    selectQueue.items.push([{ userId: "user-a", email: "assignee@example.com" }]);
    selectQueue.items.push([{ name: "Acme Corp" }]);

    await detectAndMarkSlaBreaches([BASE_TASK] as any, "test-org", [POLICY] as any);

    // Wait for both async select calls inside the fire-and-forget IIFE
    await vi.waitFor(() => {
      expect(sendMailSpy).toHaveBeenCalledOnce();
    });

    const callArgs = sendMailSpy.mock.calls[0][0];
    expect(callArgs.to).toBe("assignee@example.com");
    expect(callArgs.subject).toContain("SLA breach");
    expect(callArgs.html).toBe("<html>breach</html>");
  });

  it("does NOT call sendMail when SMTP is not configured", async () => {
    // isEmailConfigured defaults to false
    selectQueue.items.push([{ userId: "user-a", email: "assignee@example.com" }]);

    await detectAndMarkSlaBreaches([BASE_TASK] as any, "test-org", [POLICY] as any);

    // Flush the IIFE
    await vi.waitFor(() => {
      expect(notifySlaBreachedSpy).toHaveBeenCalledOnce();
    });

    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  it("skips the assignee notification path when the task has no assignee", async () => {
    const taskNoAssignee = { ...BASE_TASK, assignee: null };

    await detectAndMarkSlaBreaches([taskNoAssignee] as any, "test-org", [POLICY] as any);

    // No IIFE is started — no flush needed
    expect(notifySlaBreachedSpy).not.toHaveBeenCalled();
    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for a task that has already been marked slaBreachedAt", async () => {
    const alreadyBreached = { ...BASE_TASK, slaBreachedAt: new Date() };

    await detectAndMarkSlaBreaches([alreadyBreached] as any, "test-org", [POLICY] as any);

    expect(notifySlaBreachedSpy).not.toHaveBeenCalled();
    expect(sendMailSpy).not.toHaveBeenCalled();
    expect(dispatchTaskSlaBreachedSpy).not.toHaveBeenCalled();
  });
});
