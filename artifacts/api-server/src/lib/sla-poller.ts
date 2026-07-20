/**
 * Background SLA breach/warning poller.
 *
 * GET /tasks and GET /tasks/:id passively invoke detectAndMarkSlaBreaches for
 * whatever tasks the caller happens to be viewing.  That mechanism misses tasks
 * when:
 *   - The UI is idle (nobody is browsing the tasks list).
 *   - The client filters by status=done or a specific project, so breached tasks
 *     in other states are never included in the evaluated set.
 *
 * This poller runs every 60 s and scans ALL open tasks across ALL orgs so that
 * SLA webhooks fire reliably regardless of user activity.
 *
 * Concurrency safety: detectAndMarkSlaBreaches uses atomic DB updates
 * (WHERE sla_breached_at IS NULL) so simultaneous runs from this poller and a
 * passive read cannot double-fire the same webhook.
 */

import { eq, inArray, ne, or, isNull } from "drizzle-orm";
import { db, tasksTable, slaPoliciesTable } from "@workspace/db";
import { detectAndMarkSlaBreaches } from "./sla-detection";
import { logger } from "./logger";

/**
 * One scan pass: find all open tasks that still need SLA evaluation, group them
 * by org, and run breach/warning detection for each org.
 */
export async function scanSlaBreaches(): Promise<void> {
  // Fetch all open tasks that still need SLA evaluation.
  // "Still need" = at least one SLA timestamp is still unset.
  // (Tasks already both-breached AND warned are finished — exclude them to keep
  //  the query small on busy instances.)
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      // Not done AND at least one SLA flag still absent
      ne(tasksTable.status, "done"),
    );

  if (tasks.length === 0) return;

  // Group by orgId
  const byOrg = new Map<string, (typeof tasksTable.$inferSelect)[]>();
  for (const task of tasks) {
    if (!task.orgId) continue;
    const list = byOrg.get(task.orgId);
    if (list) {
      list.push(task);
    } else {
      byOrg.set(task.orgId, [task]);
    }
  }

  const orgIds = [...byOrg.keys()];
  if (orgIds.length === 0) return;

  // Fetch all SLA policies for all affected orgs in one query
  const allPolicies = await db
    .select()
    .from(slaPoliciesTable)
    .where(inArray(slaPoliciesTable.orgId, orgIds));

  // Group policies by orgId
  const policiesByOrg = new Map<string, (typeof slaPoliciesTable.$inferSelect)[]>();
  for (const p of allPolicies) {
    const list = policiesByOrg.get(p.orgId);
    if (list) {
      list.push(p);
    } else {
      policiesByOrg.set(p.orgId, [p]);
    }
  }

  // Run detection per org (detectAndMarkSlaBreaches already handles its own errors)
  await Promise.all(
    orgIds.map((orgId) =>
      detectAndMarkSlaBreaches(
        byOrg.get(orgId)!,
        orgId,
        policiesByOrg.get(orgId) ?? [],
      ),
    ),
  );
}

/**
 * Start the background SLA poller.
 * Call once from the server entry point after the DB is ready.
 *
 * @param intervalMs  How often to scan (default 60 s). Pass a smaller value in
 *                    tests or high-SLA environments; pass 0 to disable.
 * @returns  The interval handle (call clearInterval to stop).
 */
export function startSlaPoller(intervalMs = 60_000): ReturnType<typeof setInterval> | null {
  if (intervalMs <= 0) return null;

  logger.info({ intervalMs }, "SLA breach poller started");

  // Run once immediately on startup so recently-breached tasks don't wait a full
  // interval before their webhook fires after a server restart.
  scanSlaBreaches().catch((err) => logger.error({ err }, "SLA poller startup scan error"));

  return setInterval(() => {
    scanSlaBreaches().catch((err) => logger.error({ err }, "SLA poller interval error"));
  }, intervalMs);
}
