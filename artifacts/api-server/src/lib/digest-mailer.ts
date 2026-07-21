/**
 * Email digest mailer — runs hourly and sends daily/weekly digest emails.
 *
 * - "daily"  users: sent when 20+ hours have elapsed since lastSentAt (or never sent).
 * - "weekly" users: sent when 6+ days have elapsed since lastSentAt (or never sent).
 *
 * Digest preference is per-user (not per-org). The mailer aggregates unread
 * notifications across ALL orgs the user belongs to, groups them by org for
 * readability, and updates lastSentAt once after all orgs are processed.
 *
 * Users with no unread notifications in any org since their last digest are skipped.
 *
 * Duplicate-send prevention
 * ─────────────────────────
 * A "claim" pattern with optimistic concurrency guards against duplicate sends:
 *
 *   1. Eligibility: SELECT users due for a digest (lastSentAt cutoff check).
 *   2. Unread check: skip users who have nothing new to send (no claim taken).
 *   3. Claim: atomically UPDATE SET digestClaimedAt = now WHERE
 *        userId = ?
 *        AND (lastSentAt = <pre-read value> OR lastSentAt IS NULL)  ← OCC guard
 *        AND (digestClaimedAt IS NULL OR digestClaimedAt < claimCutoff)
 *      If 0 rows updated:
 *        - Another process already holds a fresh claim, OR
 *        - lastSentAt has changed (a concurrent worker already sent for this
 *          window and wrote a new lastSentAt) → skip to avoid duplicate send.
 *   4. Send: deliver the email inside a try/finally.
 *   5. Success: write lastSentAt and clear digestClaimedAt (→ NULL).
 *   6. Failure / exception: finally block clears digestClaimedAt so the next
 *      run can retry.
 *
 * The OCC guard on lastSentAt in the claim WHERE closes the race where two
 * workers both read the same stale row; worker A finishes and clears the claim,
 * then worker B can no longer re-claim because lastSentAt no longer matches.
 *
 * A brief randomized startup jitter (0–30 s) also reduces the chance that
 * multiple clustered restarts fire simultaneously.
 */

import { and, eq, isNull, or, lt, inArray } from "drizzle-orm";
import {
  db,
  emailDigestPreferencesTable,
  notificationsTable,
  usersTable,
  orgMembersTable,
  organizationsTable,
} from "@workspace/db";
import { sendMail, buildDigestEmail, isEmailConfigured } from "./email";
import { generateUnsubscribeToken } from "./unsubscribe-token";
import { logger } from "./logger";

const APP_URL = (process.env["APP_URL"] ?? "").replace(/\/$/, "");

const DAILY_GAP_MS  = 20 * 60 * 60 * 1000; // 20 h
const WEEKLY_GAP_MS = 6  * 24 * 60 * 60 * 1000; // 6 d

/**
 * A claim is considered stale after this many milliseconds, allowing a
 * subsequent process to take over if the previous one crashed mid-send.
 * Set equal to the shortest gap (daily = 20 h) as an upper-bound safety net;
 * in practice the claim is cleared immediately after each send attempt.
 */
const CLAIM_TTL_MS = DAILY_GAP_MS;

/** Release the claim on a user's preference row (set digestClaimedAt → NULL). */
async function releaseClaim(userId: string, now: Date): Promise<void> {
  await db
    .update(emailDigestPreferencesTable)
    .set({ digestClaimedAt: null, updatedAt: now })
    .where(eq(emailDigestPreferencesTable.userId, userId));
}

async function runDigest(): Promise<void> {
  if (!isEmailConfigured()) return;

  try {
    const now = new Date();

    // ── Find users due for a digest ──────────────────────────────────────────
    const dailyCutoff  = new Date(now.getTime() - DAILY_GAP_MS);
    const weeklyCutoff = new Date(now.getTime() - WEEKLY_GAP_MS);
    // A claim is stale when it's older than CLAIM_TTL_MS (crashed process).
    const claimCutoff  = new Date(now.getTime() - CLAIM_TTL_MS);

    const duePref = await db
      .select()
      .from(emailDigestPreferencesTable)
      .where(
        or(
          and(
            eq(emailDigestPreferencesTable.frequency, "daily"),
            or(
              isNull(emailDigestPreferencesTable.lastSentAt),
              lt(emailDigestPreferencesTable.lastSentAt, dailyCutoff),
            ),
            // Skip rows that are already claimed by a concurrent process.
            or(
              isNull(emailDigestPreferencesTable.digestClaimedAt),
              lt(emailDigestPreferencesTable.digestClaimedAt, claimCutoff),
            ),
          ),
          and(
            eq(emailDigestPreferencesTable.frequency, "weekly"),
            or(
              isNull(emailDigestPreferencesTable.lastSentAt),
              lt(emailDigestPreferencesTable.lastSentAt, weeklyCutoff),
            ),
            or(
              isNull(emailDigestPreferencesTable.digestClaimedAt),
              lt(emailDigestPreferencesTable.digestClaimedAt, claimCutoff),
            ),
          ),
        ),
      );

    if (duePref.length === 0) return;

    const userIds = duePref.map((p) => p.userId);

    // ── Resolve user emails and names ─────────────────────────────────────────
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));

    const userMap = new Map(users.map((u) => [u.id, u]));

    // ── Resolve ALL org memberships per user ──────────────────────────────────
    const memberships = await db
      .select({
        userId: orgMembersTable.userId,
        orgName: organizationsTable.name,
        orgId: orgMembersTable.orgId,
      })
      .from(orgMembersTable)
      .innerJoin(
        organizationsTable,
        eq(orgMembersTable.orgId, organizationsTable.id),
      )
      .where(inArray(orgMembersTable.userId, userIds));

    const membershipsByUser = new Map<
      string,
      Array<{ orgId: string; orgName: string }>
    >();
    for (const m of memberships) {
      if (!membershipsByUser.has(m.userId)) membershipsByUser.set(m.userId, []);
      membershipsByUser.get(m.userId)!.push({ orgId: m.orgId, orgName: m.orgName });
    }

    // ── Process each user ────────────────────────────────────────────────────
    for (const pref of duePref) {
      const user = userMap.get(pref.userId);
      const userOrgs = membershipsByUser.get(pref.userId) ?? [];

      if (!user?.email || userOrgs.length === 0) continue;

      // ── Step 1: Check for unread notifications BEFORE claiming ────────────
      // This avoids holding a claim on users who have nothing to send.
      const lastSent = pref.lastSentAt;
      const orgIds = userOrgs.map((o) => o.orgId);

      const allUnread = await db
        .select({
          id: notificationsTable.id,
          message: notificationsTable.message,
          entityType: notificationsTable.entityType,
          entityId: notificationsTable.entityId,
          createdAt: notificationsTable.createdAt,
          orgId: notificationsTable.orgId,
        })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, pref.userId),
            eq(notificationsTable.read, false),
            inArray(notificationsTable.orgId, orgIds),
          ),
        )
        .orderBy(notificationsTable.createdAt);

      const notifications = lastSent
        ? allUnread.filter((n) => n.createdAt > lastSent)
        : allUnread;

      // No new notifications → skip without ever touching digestClaimedAt.
      if (notifications.length === 0) continue;

      // ── Step 2: Atomically claim this user's digest slot ──────────────────
      // The WHERE includes lastSentAt = <pre-read value> as an optimistic-
      // concurrency guard. If another worker already sent for this window and
      // wrote a new lastSentAt, our claim will find 0 rows and we skip — even
      // if digestClaimedAt was cleared by the other worker.
      const lastSentAtGuard = pref.lastSentAt
        ? eq(emailDigestPreferencesTable.lastSentAt, pref.lastSentAt)
        : isNull(emailDigestPreferencesTable.lastSentAt);

      const claimed = await db
        .update(emailDigestPreferencesTable)
        .set({ digestClaimedAt: now })
        .where(
          and(
            eq(emailDigestPreferencesTable.userId, pref.userId),
            lastSentAtGuard,
            or(
              isNull(emailDigestPreferencesTable.digestClaimedAt),
              lt(emailDigestPreferencesTable.digestClaimedAt, claimCutoff),
            ),
          ),
        )
        .returning({ userId: emailDigestPreferencesTable.userId });

      if (claimed.length === 0) {
        logger.info({ userId: pref.userId }, "Digest claim lost — skipping (concurrent send or stale data)");
        continue;
      }

      // ── Step 3: Build and send the email (claim is held) ─────────────────
      // try/finally guarantees the claim is released even if an unexpected
      // exception is thrown after claiming.
      let sendSucceeded = false;
      try {
        const primaryOrg = userOrgs[0]!;
        const orgLabel =
          userOrgs.length === 1
            ? primaryOrg.orgName
            : `${primaryOrg.orgName} (and ${userOrgs.length - 1} other org${userOrgs.length > 2 ? "s" : ""})`;

        const userName =
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.email;

        const unsubscribeToken = generateUnsubscribeToken(pref.userId);
        const unsubscribeUrl = `${APP_URL}/unsubscribe?token=${unsubscribeToken}`;

        const html = buildDigestEmail({
          orgName: orgLabel,
          userName,
          notifications: notifications.map((n) => ({
            message: n.message,
            createdAt: n.createdAt,
            entityType: n.entityType,
            entityId: n.entityId,
          })),
          appUrl: APP_URL,
          frequency: pref.frequency as "daily" | "weekly",
          unsubscribeUrl,
        });

        const result = await sendMail({
          to: user.email,
          subject: `Your ${pref.frequency} digest — ${notifications.length} notification${notifications.length !== 1 ? "s" : ""}`,
          html,
        });

        if (result.ok) {
          // ── Step 4 (success): write lastSentAt and release the claim ─────
          await db
            .update(emailDigestPreferencesTable)
            .set({ lastSentAt: now, digestClaimedAt: null, updatedAt: now })
            .where(eq(emailDigestPreferencesTable.userId, pref.userId));
          sendSucceeded = true;
          logger.info(
            { userId: pref.userId, count: notifications.length, orgCount: userOrgs.length },
            "Digest email sent",
          );
        } else {
          logger.warn({ userId: pref.userId }, "Digest send failed — claim will be released for retry");
        }
      } finally {
        // ── Step 4 (failure / exception): release the claim so the next
        // run can retry. No-op if sendSucceeded (claim already cleared above).
        if (!sendSucceeded) {
          await releaseClaim(pref.userId, now);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Digest mailer error");
  }
}

/**
 * Start the digest mailer. Fires after a short randomized jitter (0–30 s) to
 * reduce duplicate sends when multiple processes restart simultaneously, then
 * every hour thereafter. Returns the interval handle for cleanup on shutdown.
 */
export function startDigestMailer(): ReturnType<typeof setInterval> {
  const jitterMs = Math.floor(Math.random() * 30_000); // 0–30 s
  setTimeout(() => void runDigest(), jitterMs);
  return setInterval(() => void runDigest(), 60 * 60 * 1000);
}
