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
import { logger } from "./logger";

const APP_URL = (process.env["APP_URL"] ?? "").replace(/\/$/, "");

const DAILY_GAP_MS  = 20 * 60 * 60 * 1000; // 20 h
const WEEKLY_GAP_MS = 6  * 24 * 60 * 60 * 1000; // 6 d

async function runDigest(): Promise<void> {
  if (!isEmailConfigured()) return;

  try {
    const now = new Date();

    // ── Find users due for a digest ──────────────────────────────────────────
    const dailyCutoff  = new Date(now.getTime() - DAILY_GAP_MS);
    const weeklyCutoff = new Date(now.getTime() - WEEKLY_GAP_MS);

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
          ),
          and(
            eq(emailDigestPreferencesTable.frequency, "weekly"),
            or(
              isNull(emailDigestPreferencesTable.lastSentAt),
              lt(emailDigestPreferencesTable.lastSentAt, weeklyCutoff),
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
    // Group into a Map<userId, Array<{orgId, orgName}>> so every org a user
    // belongs to is included in their digest.
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

      // Aggregate unread notifications across ALL orgs since lastSentAt.
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

      // Filter to notifications created after the last digest (JS filter to
      // avoid needing gt import; list is bounded to recent unread items).
      const notifications = lastSent
        ? allUnread.filter((n) => n.createdAt > lastSent)
        : allUnread;

      if (notifications.length === 0) continue;

      // Use the org of the first notification for the email greeting; all
      // notifications are linked individually so cross-org context is clear.
      const primaryOrg = userOrgs[0]!;
      const orgLabel =
        userOrgs.length === 1
          ? primaryOrg.orgName
          : `${primaryOrg.orgName} (and ${userOrgs.length - 1} other org${userOrgs.length > 2 ? "s" : ""})`;

      const userName =
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.email;

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
      });

      const result = await sendMail({
        to: user.email,
        subject: `Your ${pref.frequency} digest — ${notifications.length} notification${notifications.length !== 1 ? "s" : ""}`,
        html,
      });

      if (result.ok) {
        // Advance lastSentAt only after all orgs have been processed and the
        // email has been delivered, so no notifications are silently skipped.
        await db
          .update(emailDigestPreferencesTable)
          .set({ lastSentAt: now, updatedAt: now })
          .where(eq(emailDigestPreferencesTable.userId, pref.userId));
        logger.info(
          { userId: pref.userId, count: notifications.length, orgCount: userOrgs.length },
          "Digest email sent",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Digest mailer error");
  }
}

/**
 * Start the digest mailer. Runs once immediately and then every hour.
 * Returns the interval handle for cleanup on shutdown.
 */
export function startDigestMailer(): ReturnType<typeof setInterval> {
  // Run immediately (fire-and-forget) then every hour
  void runDigest();
  return setInterval(() => void runDigest(), 60 * 60 * 1000);
}
