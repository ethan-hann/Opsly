/**
 * SLA breach and warning detection.
 *
 * detectAndMarkSlaBreaches is called:
 *  - Passively: on GET /tasks and GET /tasks/:id (immediate feedback for the
 *    current org's tasks with whatever filters the caller applied).
 *  - Actively:  from the background SLA poller, which scans every open task
 *    across every org every 60 s so webhooks fire even when no one is browsing.
 *
 * The atomic "WHERE sla_breached_at IS NULL" guard in the DB update means both
 * code paths are safe to run concurrently — exactly one caller wins the race.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, tasksTable, slaPoliciesTable } from "@workspace/db";
import { getSlaStatus } from "./sla";
import { dispatchTaskSlaBreached, dispatchSlaWarning } from "./webhook-dispatcher";
import { logger } from "./logger";

/**
 * For a list of tasks (all from the same org), detect any that have breached
 * their resolution SLA or crossed the warning threshold, stamp the relevant
 * timestamp atomically, and fire the outbound webhook.
 *
 * Fire-and-forget safe: all errors are logged and swallowed so a breach
 * detection failure never blocks or rejects the calling request.
 */
export async function detectAndMarkSlaBreaches(
  tasks: (typeof tasksTable.$inferSelect)[],
  orgId: string,
  policies: (typeof slaPoliciesTable.$inferSelect)[],
): Promise<void> {
  try {
    // Only evaluate open tasks that haven't been fully flagged yet
    const candidates = tasks.filter(
      (t) => t.status !== "done" && t.slaBreachedAt == null,
    );
    if (candidates.length === 0) return;

    // Build two-level policy maps: project-level takes precedence over org-level
    const orgPolicyMap = new Map<string, typeof slaPoliciesTable.$inferSelect>();
    const projectPolicyMap = new Map<number, Map<string, typeof slaPoliciesTable.$inferSelect>>();
    for (const p of policies) {
      if (p.projectId == null) {
        orgPolicyMap.set(p.priority, p);
      } else {
        if (!projectPolicyMap.has(p.projectId)) {
          projectPolicyMap.set(p.projectId, new Map());
        }
        projectPolicyMap.get(p.projectId)!.set(p.priority, p);
      }
    }

    for (const task of candidates) {
      const projectPolicy = task.projectId != null
        ? projectPolicyMap.get(task.projectId)?.get(task.priority)
        : undefined;
      const policy = projectPolicy ?? orgPolicyMap.get(task.priority) ?? null;
      const slaResult = getSlaStatus(task.createdAt, task.status, task.priority, policy);

      if (slaResult.isResolutionBreached) {
        const now = new Date();
        // Atomic: only dispatch if this process is the first to set slaBreachedAt
        const [updated] = await db
          .update(tasksTable)
          .set({ slaBreachedAt: now })
          .where(and(eq(tasksTable.id, task.id), eq(tasksTable.orgId, orgId), isNull(tasksTable.slaBreachedAt)))
          .returning({ id: tasksTable.id });

        if (updated) {
          const minutesOverdue = Math.abs(slaResult.resolutionMinutesRemaining ?? 0);
          dispatchTaskSlaBreached(orgId, task.projectId, {
            id: task.id,
            orgTaskNumber: task.orgTaskNumber,
            title: task.title,
            priority: task.priority,
            status: task.status,
            slaBreachedAt: now.toISOString(),
          }, minutesOverdue);
        }
      } else if (
        task.slaWarningSentAt == null &&
        policy != null &&
        policy.resolutionMinutes != null
      ) {
        // Warning: fire once when elapsed% ≥ warningThresholdPercent (default 80%)
        const thresholdFraction = (policy.warningThresholdPercent ?? 80) / 100;
        const elapsedMinutes = (Date.now() - new Date(task.createdAt).getTime()) / 60_000;
        const elapsedFraction = elapsedMinutes / policy.resolutionMinutes;

        if (elapsedFraction >= thresholdFraction) {
          const now = new Date();
          const projectedBreachAt = new Date(
            new Date(task.createdAt).getTime() + policy.resolutionMinutes * 60_000,
          ).toISOString();
          const minutesUntilBreach = Math.max(0, Math.round(policy.resolutionMinutes - elapsedMinutes));

          // Atomic: only dispatch if this process is the first to set slaWarningSentAt
          const [updated] = await db
            .update(tasksTable)
            .set({ slaWarningSentAt: now })
            .where(and(eq(tasksTable.id, task.id), eq(tasksTable.orgId, orgId), isNull(tasksTable.slaWarningSentAt)))
            .returning({ id: tasksTable.id });

          if (updated) {
            dispatchSlaWarning(orgId, task.projectId, {
              id: task.id,
              orgTaskNumber: task.orgTaskNumber,
              title: task.title,
              priority: task.priority,
              status: task.status,
            }, Math.round(elapsedFraction * 100), projectedBreachAt, minutesUntilBreach);
          }
        }
      }
    }
  } catch (err) {
    // Log the error — never let SLA breach detection fail the calling response
    logger.error({ err, orgId }, "SLA breach detection error");
  }
}
