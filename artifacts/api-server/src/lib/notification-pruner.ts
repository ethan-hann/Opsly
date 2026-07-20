/**
 * Background job that deletes notifications older than 30 days.
 * Runs once on startup and then every 6 hours.
 */

import { lt } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { logger } from "./logger";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours

async function pruneOldNotifications(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const deleted = await db
      .delete(notificationsTable)
      .where(lt(notificationsTable.createdAt, cutoff))
      .returning({ id: notificationsTable.id });

    if (deleted.length > 0) {
      logger.info({ count: deleted.length }, "Pruned old notifications");
    }
  } catch (err) {
    logger.error({ err }, "Notification pruner error");
  }
}

export function startNotificationPruner(): ReturnType<typeof setInterval> {
  // Run once immediately on startup
  pruneOldNotifications().catch(() => {});

  return setInterval(() => {
    pruneOldNotifications().catch(() => {});
  }, INTERVAL_MS);
}
