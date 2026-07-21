/**
 * Notification dispatch helper.
 *
 * Creates in-app notifications for users and pushes a lightweight SSE event
 * so the bell badge updates instantly without polling.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  notificationPreferencesTable,
} from "@workspace/db";
import type { NotificationType } from "@workspace/db";
import { pushEvent } from "./sse";
import { logger } from "./logger";

/**
 * Check whether a user has enabled a given notification type.
 * Defaults to enabled when no preference row exists (opt-out model).
 */
async function isEnabled(
  userId: string,
  orgId: string,
  type: NotificationType,
): Promise<boolean> {
  const [pref] = await db
    .select({ enabled: notificationPreferencesTable.enabled })
    .from(notificationPreferencesTable)
    .where(
      and(
        eq(notificationPreferencesTable.userId, userId),
        eq(notificationPreferencesTable.orgId, orgId),
        eq(notificationPreferencesTable.eventType, type),
      ),
    )
    .limit(1);

  // Missing row → enabled by default
  return pref === undefined ? true : pref.enabled;
}

/**
 * Create a single in-app notification and push an SSE event to the user.
 *
 * Fire-and-forget safe: all errors are caught and logged so callers are
 * never rejected by notification failures.
 */
export async function createNotification(opts: {
  userId: string;
  orgId: string;
  type: NotificationType;
  actorId?: string | null;
  actorName?: string | null;
  entityType: "task" | "comment" | "project" | "export";
  entityId: number;
  message: string;
}): Promise<void> {
  try {
    const enabled = await isEnabled(opts.userId, opts.orgId, opts.type);
    if (!enabled) return;

    await db.insert(notificationsTable).values({
      userId: opts.userId,
      orgId: opts.orgId,
      type: opts.type,
      actorId: opts.actorId ?? null,
      actorName: opts.actorName ?? null,
      entityType: opts.entityType,
      entityId: opts.entityId,
      message: opts.message,
      read: false,
    });

    // Count unread to include in SSE payload
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, opts.userId),
          eq(notificationsTable.orgId, opts.orgId),
          eq(notificationsTable.read, false),
        ),
      );

    pushEvent(opts.userId, "notification", { unread_count: count, type: opts.type });
  } catch (err) {
    logger.error({ err, opts }, "Failed to create notification");
  }
}

/**
 * Dispatch task-assignment notifications to the new assignee.
 *
 * Call after a task's assignee field changes.
 *
 * @param newAssigneeUserId  User ID (not email) of the new assignee
 * @param prevAssigneeEmail  Previous assignee email (may be null)
 * @param newAssigneeEmail   New assignee email (may be null)
 */
export async function notifyTaskAssigned(opts: {
  taskId: number;
  taskTitle: string;
  orgId: string;
  actorId: string | null;
  actorName: string | null;
  newAssigneeUserId: string;
}): Promise<void> {
  // Don't notify if the actor assigned the task to themselves
  if (opts.actorId && opts.actorId === opts.newAssigneeUserId) return;

  const actorLabel = opts.actorName ?? "Someone";
  await createNotification({
    userId: opts.newAssigneeUserId,
    orgId: opts.orgId,
    type: "task_assigned",
    actorId: opts.actorId,
    actorName: opts.actorName,
    entityType: "task",
    entityId: opts.taskId,
    message: `${actorLabel} assigned you to "${opts.taskTitle}"`,
  });
}

/**
 * Dispatch task-updated notifications (status / priority changes) to the
 * current assignee (if any) and any future watchers list.
 */
export async function notifyTaskUpdated(opts: {
  taskId: number;
  taskTitle: string;
  orgId: string;
  actorId: string | null;
  actorName: string | null;
  /** User IDs to notify (assignee, watchers — caller deduplicates). */
  recipientUserIds: string[];
  /** Human-readable field that changed, e.g. "status" */
  changedField: string;
  newValue: string;
}): Promise<void> {
  const actorLabel = opts.actorName ?? "Someone";
  const message = `${actorLabel} changed ${opts.changedField} to "${opts.newValue}" on "${opts.taskTitle}"`;

  await Promise.all(
    opts.recipientUserIds
      .filter((id) => id !== opts.actorId) // don't notify the actor
      .map((userId) =>
        createNotification({
          userId,
          orgId: opts.orgId,
          type: "task_updated",
          actorId: opts.actorId,
          actorName: opts.actorName,
          entityType: "task",
          entityId: opts.taskId,
          message,
        }),
      ),
  );
}

/**
 * Dispatch comment-added notifications to the task assignee.
 * (Watchers extension point left for Task Watchers feature.)
 */
export async function notifyCommentAdded(opts: {
  taskId: number;
  taskTitle: string;
  orgId: string;
  actorId: string | null;
  actorName: string | null;
  /** User IDs to notify (assignee, watchers — caller deduplicates). */
  recipientUserIds: string[];
}): Promise<void> {
  const actorLabel = opts.actorName ?? "Someone";
  const message = `${actorLabel} commented on "${opts.taskTitle}"`;

  await Promise.all(
    opts.recipientUserIds
      .filter((id) => id !== opts.actorId)
      .map((userId) =>
        createNotification({
          userId,
          orgId: opts.orgId,
          type: "comment_added",
          actorId: opts.actorId,
          actorName: opts.actorName,
          entityType: "task",
          entityId: opts.taskId,
          message,
        }),
      ),
  );
}

/**
 * Dispatch @mention notifications.
 *
 * Called after a comment is created when one or more @[userId:…] or
 * @[everyone] tokens are present. Each named user — or every active org
 * member for @everyone — receives a `mention` notification.
 *
 * The caller is responsible for excluding mention recipients from the
 * parallel `notifyCommentAdded` call so they don't receive both.
 */
export async function notifyMentions(opts: {
  taskId: number;
  taskTitle: string;
  orgId: string;
  actorId: string | null;
  actorName: string | null;
  /** Deduplicated set of userIds to notify (commenter already excluded). */
  recipientUserIds: string[];
}): Promise<void> {
  const actorLabel = opts.actorName ?? "Someone";
  const message = `${actorLabel} mentioned you in a comment on "${opts.taskTitle}"`;

  await Promise.all(
    opts.recipientUserIds
      .filter((id) => id !== opts.actorId)
      .map((userId) =>
        createNotification({
          userId,
          orgId: opts.orgId,
          type: "mention",
          actorId: opts.actorId,
          actorName: opts.actorName,
          entityType: "task",
          entityId: opts.taskId,
          message,
        }),
      ),
  );
}

/**
 * Dispatch a reply notification to the author of the parent comment.
 *
 * Called after a threaded reply is inserted (comment.parentId != null).
 * The notification is only sent if the replier is a different user from
 * the parent comment's author.
 */
export async function notifyCommentReply(opts: {
  taskId: number;
  taskTitle: string;
  orgId: string;
  actorId: string | null;
  actorName: string | null;
  /** userId of the parent comment's author. */
  recipientUserId: string;
}): Promise<void> {
  // Never notify someone that their own reply appeared on their comment
  if (opts.actorId && opts.actorId === opts.recipientUserId) return;

  const actorLabel = opts.actorName ?? "Someone";
  await createNotification({
    userId: opts.recipientUserId,
    orgId: opts.orgId,
    type: "comment_reply",
    actorId: opts.actorId,
    actorName: opts.actorName,
    entityType: "task",
    entityId: opts.taskId,
    message: `${actorLabel} replied to your comment on "${opts.taskTitle}"`,
  });
}

/**
 * Dispatch SLA breach notifications.
 */
export async function notifySlaBreached(opts: {
  taskId: number;
  taskTitle: string;
  orgId: string;
  /** User IDs of the assignee (and future watchers) to notify. */
  recipientUserIds: string[];
}): Promise<void> {
  await Promise.all(
    opts.recipientUserIds.map((userId) =>
      createNotification({
        userId,
        orgId: opts.orgId,
        type: "sla_breached",
        actorId: null,
        actorName: null,
        entityType: "task",
        entityId: opts.taskId,
        message: `SLA breached on "${opts.taskTitle}"`,
      }),
    ),
  );
}
