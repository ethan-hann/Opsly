/**
 * SLA breach and warning detection.
 *
 * detectAndMarkSlaBreaches is called:
 *  - Passively: on GET /tasks and GET /tasks/:id (immediate feedback for the
 *    current org's tasks with whatever filters the caller applied).
 *  - Actively:  from the background SLA poller, which scans every open task
 *    across every org every 60 s so webhooks fire even when no one is browsing.
 *
 * The atomic "WHERE sla_breached_at IS NULL" / "WHERE sla_warning_sent_at IS NULL"
 * guards in the DB updates mean both code paths are safe to run concurrently —
 * exactly one caller wins the race.
 *
 * Both resolution SLA (resolutionMinutes) and response SLA (responseMinutes)
 * are evaluated. Whichever breaches first stamps slaBreachedAt and fires the
 * task.sla_breached webhook. This ensures the webhook fires even when a policy
 * only configures one of the two SLA types.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, tasksTable, slaPoliciesTable, workflowStagesTable, taskEventsTable, orgMembersTable, usersTable, organizationsTable } from "@workspace/db";
import { getSlaStatus } from "./sla";
import { dispatchTaskSlaBreached, dispatchSlaWarning } from "./webhook-dispatcher";
import { notifySlaBreached } from "./notifications";
import { sendMail, buildSlaBreachEmail, isEmailConfigured } from "./email";
import { logger } from "./logger";

type StagesMap = Map<number, typeof workflowStagesTable.$inferSelect>;

/**
 * For a list of tasks (all from the same org), detect any that have breached
 * their resolution or response SLA, stamp the relevant timestamp atomically,
 * and fire the outbound webhook.
 *
 * Fire-and-forget safe: all errors are caught and logged so detection never
 * blocks or rejects the calling request.
 *
 * @param stages  Optional map of workflow stages keyed by ID. When provided,
 *                stage type is used to determine open/closed; otherwise falls
 *                back to the legacy `status !== "done"` check.
 */
export async function detectAndMarkSlaBreaches(
  tasks: (typeof tasksTable.$inferSelect)[],
  orgId: string,
  policies: (typeof slaPoliciesTable.$inferSelect)[],
  stages?: StagesMap,
): Promise<void> {
  try {
    // Only evaluate open tasks that haven't been fully flagged yet
    const candidates = tasks.filter((t) => {
      if (t.slaBreachedAt != null) return false;
      const stageId = parseInt(t.status, 10);
      if (!isNaN(stageId)) {
        // Task uses a custom workflow stage (numeric ID).
        // stages map must be provided and must contain this ID, otherwise we
        // cannot determine open/closed — skip rather than risk a false breach.
        if (!stages) return false;
        const stage = stages.get(stageId);
        if (!stage) return false;
        return stage.type === "open";
      }
      // Legacy string status — "done" means closed; anything else is open.
      return t.status !== "done";
    });
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

      if (!policy) continue; // no SLA configured for this priority

      const slaResult = getSlaStatus(task.createdAt, task.status, task.priority, policy);

      // ── Breach detection ────────────────────────────────────────────────────
      // Fire when EITHER the resolution or response SLA is breached.
      const isSlaBreached =
        slaResult.isResolutionBreached || slaResult.responseStatus === "breached";

      if (isSlaBreached) {
        const now = new Date();
        // Atomic: only dispatch if this process is the first to set slaBreachedAt
        const [updated] = await db
          .update(tasksTable)
          .set({ slaBreachedAt: now })
          .where(
            and(
              eq(tasksTable.id, task.id),
              eq(tasksTable.orgId, orgId),
              isNull(tasksTable.slaBreachedAt),
            ),
          )
          .returning({ id: tasksTable.id });

        if (updated) {
          const minutesOverdue = Math.abs(
            slaResult.isResolutionBreached
              ? (slaResult.resolutionMinutesRemaining ?? 0)
              : (slaResult.responseMinutesRemaining ?? 0),
          );
          // Encode the SLA type that was exceeded so the task history feed can
          // display "resolution limit exceeded" vs "response limit exceeded".
          // Format: "<type>|<ISO timestamp>"  e.g. "resolution|2025-06-01T12:00:00.000Z"
          const slaType = slaResult.isResolutionBreached ? "resolution" : "response";
          // Audit trail: record breach type + timestamp in task history
          await db.insert(taskEventsTable).values({
            taskId: task.id,
            orgId,
            actorId: null,
            actorName: null,
            field: "sla_breached",
            oldValue: null,
            newValue: `${slaType}|${now.toISOString()}`,
          });
          logger.info(
            { taskId: task.id, orgId, minutesOverdue },
            "SLA breached — dispatching webhook",
          );
          dispatchTaskSlaBreached(orgId, task.projectId, {
            id: task.id,
            orgTaskNumber: task.orgTaskNumber,
            title: task.title,
            priority: task.priority,
            status: task.status,
            slaBreachedAt: now.toISOString(),
          }, minutesOverdue);

          // Notify the task assignee (if any) — fire-and-forget
          if (task.assignee) {
            void (async () => {
              const [row] = await db
                .select({ userId: orgMembersTable.userId, email: usersTable.email })
                .from(orgMembersTable)
                .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
                .where(and(eq(orgMembersTable.orgId, orgId), eq(usersTable.email, task.assignee!)))
                .limit(1);
              if (row) {
                notifySlaBreached({
                  taskId: task.id,
                  taskTitle: task.title,
                  orgId,
                  recipientUserIds: [row.userId],
                });

                // Also send a breach alert email when SMTP is configured.
                if (isEmailConfigured() && row.email) {
                  const [orgRow] = await db
                    .select({ name: organizationsTable.name })
                    .from(organizationsTable)
                    .where(eq(organizationsTable.id, orgId))
                    .limit(1);

                  const appUrl = (process.env["APP_URL"] ?? "").replace(/\/$/, "");
                  const taskUrl = appUrl ? `${appUrl}/tasks/${task.id}` : "";

                  void sendMail({
                    to: row.email,
                    subject: `SLA breach: ${task.title}`,
                    html: buildSlaBreachEmail({
                      orgName: orgRow?.name ?? orgId,
                      taskTitle: task.title,
                      taskUrl,
                      priority: task.priority,
                      breachedAt: now,
                    }),
                  });
                }
              }
            })();
          }
        }

      // ── Warning detection ───────────────────────────────────────────────────
      // Fire when EITHER SLA has crossed the warning threshold (default 80 %).
      } else if (task.slaWarningSentAt == null) {
        const elapsedMinutes = (Date.now() - new Date(task.createdAt).getTime()) / 60_000;
        const thresholdFraction = (policy.warningThresholdPercent ?? 80) / 100;

        // Compute the elapsed fraction for each configured SLA type
        const resolutionFraction =
          policy.resolutionMinutes != null
            ? elapsedMinutes / policy.resolutionMinutes
            : -Infinity;
        const responseFraction =
          policy.responseMinutes != null
            ? elapsedMinutes / policy.responseMinutes
            : -Infinity;
        const maxFraction = Math.max(resolutionFraction, responseFraction);

        if (maxFraction >= thresholdFraction) {
          // Use the SLA type that's closest to breaching for the payload details
          const useResolution =
            resolutionFraction >= responseFraction && policy.resolutionMinutes != null;
          const slaMins = useResolution
            ? policy.resolutionMinutes!
            : policy.responseMinutes!;

          const now = new Date();
          const projectedBreachAt = new Date(
            new Date(task.createdAt).getTime() + slaMins * 60_000,
          ).toISOString();
          const minutesUntilBreach = Math.max(0, Math.round(slaMins - elapsedMinutes));

          // Atomic: only dispatch if this process is the first to set slaWarningSentAt
          const [updated] = await db
            .update(tasksTable)
            .set({ slaWarningSentAt: now })
            .where(
              and(
                eq(tasksTable.id, task.id),
                eq(tasksTable.orgId, orgId),
                isNull(tasksTable.slaWarningSentAt),
              ),
            )
            .returning({ id: tasksTable.id });

          if (updated) {
            // Audit trail: encode the SLA type + projected breach timestamp so the
            // history feed can display "resolution limit breach in Xm" vs "response
            // limit breach in Xm".  Format mirrors sla_breached: "<type>|<ISO>"
            const warningType = useResolution ? "resolution" : "response";
            await db.insert(taskEventsTable).values({
              taskId: task.id,
              orgId,
              actorId: null,
              actorName: null,
              field: "sla_warning",
              oldValue: null,
              newValue: `${warningType}|${projectedBreachAt}`,
            });
            logger.info(
              { taskId: task.id, orgId, percentElapsed: Math.round(maxFraction * 100) },
              "SLA warning — dispatching webhook",
            );
            dispatchSlaWarning(
              orgId,
              task.projectId,
              {
                id: task.id,
                orgTaskNumber: task.orgTaskNumber,
                title: task.title,
                priority: task.priority,
                status: task.status,
              },
              Math.round(maxFraction * 100),
              projectedBreachAt,
              minutesUntilBreach,
            );
          }
        }
      }
    }
  } catch (err) {
    // Log and swallow — never let SLA detection fail the calling response
    logger.error({ err, orgId }, "SLA breach detection error");
  }
}
