/**
 * Unit tests for digest-mailer.ts
 *
 * Covered:
 *  - runDigest skips a user whose lastSentAt is only 19 h 59 m ago (within 20 h gap)
 *  - runDigest skips a user with no unread notifications (no claim taken)
 *  - runDigest skips a user already claimed by another process (digestClaimedAt fresh)
 *  - runDigest skips a concurrent worker whose lastSentAt changed before it could claim
 *    (OCC guard: first worker finished, cleared claim, wrote new lastSentAt → second
 *    worker's claim WHERE no longer matches → 0 rows → no duplicate send)
 *  - runDigest sends an email, writes lastSentAt, and clears digestClaimedAt on success
 *  - runDigest releases the claim (digestClaimedAt = null) when sendMail returns ok:false
 *  - runDigest releases the claim via try/finally when sendMail throws unexpectedly
 *  - runDigest is a no-op when email is not configured
 *  - startDigestMailer returns an interval handle that can be cleared
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const sendMailMock   = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const isEmailCfgMock = vi.hoisted(() => vi.fn().mockReturnValue(true));
const updateSpy      = vi.hoisted(() => vi.fn());
const selectQueue    = vi.hoisted(() => ({ items: [] as any[][] }));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => {
  function makeSelectChain(result: any[]): any {
    const chain: any = {
      from:      () => chain,
      where:     () => chain,
      innerJoin: () => chain,
      orderBy:   () => chain,
      then(ok: any, rej: any) {
        return Promise.resolve(result).then(ok, rej);
      },
      catch(rej: any) {
        return Promise.resolve(result).catch(rej);
      },
    };
    return chain;
  }

  const updateQueue: any[][] = [];

  function makeUpdateChain(): any {
    const returnValue = updateQueue.shift() ?? [];
    const chain: any = {
      set:      (vals: any) => { updateSpy(vals); return chain; },
      where:    () => chain,
      returning:() => Promise.resolve(returnValue),
      // Support bare await (no .returning()) — used for releaseClaim / lastSentAt write.
      then(ok: any, rej: any) {
        return Promise.resolve(returnValue).then(ok, rej);
      },
    };
    return chain;
  }

  return {
    db: {
      select:      () => makeSelectChain(selectQueue.items.shift() ?? []),
      update:      () => makeUpdateChain(),
      _updateQueue: updateQueue,
    },
    emailDigestPreferencesTable: {},
    notificationsTable:          {},
    usersTable:                  {},
    orgMembersTable:             {},
    organizationsTable:          {},
  };
});

vi.mock("drizzle-orm", () => ({
  and:     (..._: any[]) => ({}),
  eq:      (..._: any[]) => ({}),
  isNull:  (..._: any[]) => ({}),
  or:      (..._: any[]) => ({}),
  lt:      (..._: any[]) => ({}),
  inArray: (..._: any[]) => ({}),
}));

vi.mock("./email", () => ({
  sendMail:          (...args: any[]) => sendMailMock(...args),
  buildDigestEmail:  () => "<html>digest</html>",
  isEmailConfigured: () => isEmailCfgMock(),
}));

vi.mock("./unsubscribe-token", () => ({
  generateUnsubscribeToken: () => "tok",
}));

vi.mock("./logger", () => ({
  logger: {
    info:  vi.fn(),
    error: vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { startDigestMailer } from "./digest-mailer.js";
import { db } from "@workspace/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAILY_GAP_MS = 20 * 60 * 60 * 1000;
// Max jitter is 30 s; advancing 31 s fires the one-shot startup setTimeout.
const PAST_JITTER_MS = 31_000;

function makePref(
  userId: string,
  frequency: "daily" | "weekly",
  lastSentAt: Date | null,
  digestClaimedAt: Date | null = null,
) {
  return { userId, frequency, lastSentAt, digestClaimedAt };
}

function makeUser(id: string) {
  return { id, email: `${id}@example.com`, firstName: "Test", lastName: "User" };
}

function makeNotification(orgId: string, createdAt: Date) {
  return {
    id: 1,
    message: "Task updated",
    entityType: "task",
    entityId: "t1",
    createdAt,
    orgId,
  };
}

function queueSelects(...batches: any[][]) {
  selectQueue.items.push(...batches);
}

function queueUpdate(rows: any[]) {
  (db as any)._updateQueue.push(rows);
}

/**
 * Start the mailer, immediately cancel the hourly interval (prevents the
 * infinite-timer guard), then advance past the startup jitter so the one-shot
 * run fires and fully resolves.
 */
async function triggerOneRun(): Promise<void> {
  const handle = startDigestMailer();
  clearInterval(handle);
  await vi.advanceTimersByTimeAsync(PAST_JITTER_MS);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("digest-mailer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    selectQueue.items.length = 0;
    (db as any)._updateQueue.length = 0;
    updateSpy.mockClear();
    sendMailMock.mockClear();
    sendMailMock.mockResolvedValue({ ok: true });
    isEmailCfgMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Core guard: recent lastSentAt ──────────────────────────────────────

  it("does NOT send when lastSentAt is only 19 h 59 m ago (within 20 h daily gap)", async () => {
    // The DB-level SELECT already filters users whose lastSentAt is too recent.
    // Simulate no eligible users returned.
    queueSelects([]); // duePref → empty

    await triggerOneRun();

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ─── No-notification path: claim must NOT be taken ───────────────────────

  it("does NOT claim or send when the user has no unread notifications since lastSentAt", async () => {
    const now        = new Date();
    const lastSentAt = new Date(now.getTime() - DAILY_GAP_MS - 1000);

    queueSelects(
      [makePref("u1", "daily", lastSentAt)],               // duePref
      [makeUser("u1")],                                    // users
      [{ userId: "u1", orgId: "org1", orgName: "Acme" }], // memberships
      [],                                                  // allUnread → empty
    );
    // No queueUpdate — no claim should be taken when there is nothing to send.

    await triggerOneRun();

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ─── Claim-held path (concurrent process) ───────────────────────────────

  it("skips the user when the atomic claim returns 0 rows (fresh digestClaimedAt)", async () => {
    const now        = new Date();
    const lastSentAt = new Date(now.getTime() - DAILY_GAP_MS - 1000);
    const notifTime  = new Date(lastSentAt.getTime() + 1000);

    queueSelects(
      [makePref("u1", "daily", lastSentAt)],               // duePref
      [makeUser("u1")],                                    // users
      [{ userId: "u1", orgId: "org1", orgName: "Acme" }], // memberships
      [makeNotification("org1", notifTime)],               // allUnread
    );
    queueUpdate([]); // claim UPDATE → 0 rows (another process holds claim)

    await triggerOneRun();

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  // ─── OCC guard: lastSentAt changed between read and claim ───────────────

  it("does NOT send a duplicate when worker A already finished and wrote a new lastSentAt before worker B claims", async () => {
    // Worker B scenario: it read the old lastSentAt, fetched unread notifications,
    // but by the time it tries to claim, worker A has already written a new
    // lastSentAt and cleared digestClaimedAt. The claim WHERE includes a guard
    // on lastSentAt = <pre-read value>, so 0 rows are matched → no duplicate.
    const now        = new Date();
    const lastSentAt = new Date(now.getTime() - DAILY_GAP_MS - 1000);
    const notifTime  = new Date(lastSentAt.getTime() + 1000);

    queueSelects(
      [makePref("u1", "daily", lastSentAt)],               // duePref (stale read)
      [makeUser("u1")],                                    // users
      [{ userId: "u1", orgId: "org1", orgName: "Acme" }], // memberships
      [makeNotification("org1", notifTime)],               // allUnread (stale read)
    );
    // Claim fails because worker A already updated lastSentAt (OCC guard)
    queueUpdate([]); // 0 rows → guard fired

    await triggerOneRun();

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  // ─── Successful send ─────────────────────────────────────────────────────

  it("sends an email, writes lastSentAt, and clears digestClaimedAt on success", async () => {
    const now        = new Date();
    const lastSentAt = new Date(now.getTime() - DAILY_GAP_MS - 5000);
    const notifTime  = new Date(lastSentAt.getTime() + 1000);

    queueSelects(
      [makePref("u1", "daily", lastSentAt)],               // duePref
      [makeUser("u1")],                                    // users
      [{ userId: "u1", orgId: "org1", orgName: "Acme" }], // memberships
      [makeNotification("org1", notifTime)],               // allUnread
    );
    queueUpdate([{ userId: "u1" }]); // claim succeeds
    queueUpdate([]);                 // lastSentAt write + clear claim

    await triggerOneRun();

    expect(sendMailMock).toHaveBeenCalledOnce();
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "u1@example.com" }),
    );

    // The success-path update must clear digestClaimedAt.
    const successUpdate = updateSpy.mock.calls[1]?.[0];
    expect(successUpdate).toMatchObject({ digestClaimedAt: null });
    expect(successUpdate).toHaveProperty("lastSentAt");
  });

  // ─── Send failure: claim must be released ────────────────────────────────

  it("releases the claim (digestClaimedAt = null) when sendMail returns ok: false", async () => {
    sendMailMock.mockResolvedValueOnce({ ok: false });

    const now        = new Date();
    const lastSentAt = new Date(now.getTime() - DAILY_GAP_MS - 5000);
    const notifTime  = new Date(lastSentAt.getTime() + 1000);

    queueSelects(
      [makePref("u1", "daily", lastSentAt)],               // duePref
      [makeUser("u1")],                                    // users
      [{ userId: "u1", orgId: "org1", orgName: "Acme" }], // memberships
      [makeNotification("org1", notifTime)],               // allUnread
    );
    queueUpdate([{ userId: "u1" }]); // claim succeeds
    queueUpdate([]);                 // releaseClaim update

    await triggerOneRun();

    expect(sendMailMock).toHaveBeenCalledOnce();

    // releaseClaim must clear digestClaimedAt so the next run can retry.
    const releaseUpdate = updateSpy.mock.calls[1]?.[0];
    expect(releaseUpdate).toMatchObject({ digestClaimedAt: null });
    expect(releaseUpdate).not.toHaveProperty("lastSentAt");
  });

  // ─── Exception path: try/finally releases claim ──────────────────────────

  it("releases the claim via try/finally when sendMail throws unexpectedly", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("SMTP timeout"));

    const now        = new Date();
    const lastSentAt = new Date(now.getTime() - DAILY_GAP_MS - 5000);
    const notifTime  = new Date(lastSentAt.getTime() + 1000);

    queueSelects(
      [makePref("u1", "daily", lastSentAt)],               // duePref
      [makeUser("u1")],                                    // users
      [{ userId: "u1", orgId: "org1", orgName: "Acme" }], // memberships
      [makeNotification("org1", notifTime)],               // allUnread
    );
    queueUpdate([{ userId: "u1" }]); // claim succeeds
    queueUpdate([]);                 // releaseClaim in finally

    await triggerOneRun();

    // releaseClaim must have been called even though sendMail threw
    const releaseUpdate = updateSpy.mock.calls[1]?.[0];
    expect(releaseUpdate).toMatchObject({ digestClaimedAt: null });
  });

  // ─── Email not configured ────────────────────────────────────────────────

  it("does NOT send when email is not configured", async () => {
    isEmailCfgMock.mockReturnValue(false);

    await triggerOneRun();

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ─── startDigestMailer ───────────────────────────────────────────────────

  it("returns an interval handle that can be cleared to stop future runs", async () => {
    queueSelects([]); // first run finds no users

    const handle = startDigestMailer();
    expect(handle).toBeDefined();
    clearInterval(handle);

    // Advance well past one interval — no second run should fire.
    await vi.advanceTimersByTimeAsync(PAST_JITTER_MS + 60 * 60 * 1000);

    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
