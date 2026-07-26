import { Router, type IRouter } from "express";
import { eq, sql, lt, and, isNull, isNotNull, asc, like, gte } from "drizzle-orm";
import { db, tasksTable, projectsTable, commentsTable, workflowStagesTable, taskEventsTable, slaPoliciesTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetRecentActivityResponse,
  GetDashboardSlaSummaryResponse,
} from "@workspace/api-zod";
import { requireOrg } from "../middlewares/requireOrgMiddleware";
import { requireOrgFeature } from "../lib/org-features";

const router: IRouter = Router();
const requireSlaTrackingFeature = requireOrgFeature("sla_tracking");

/**
 * Safe cast expression: only converts task.status to int when it is a
 * purely numeric string (i.e. a workflow stage ID). Returns NULL for legacy
 * string statuses ("todo", "in_progress", …) so those rows are simply
 * excluded from stage-joined queries instead of throwing a cast error.
 *
 * PostgreSQL guarantees CASE WHEN short-circuits, so the ::int branch is
 * never evaluated when the regex check fails.
 */
function safeStatusInt() {
  return sql`CASE WHEN ${tasksTable.status} ~ '^[0-9]+$' THEN ${tasksTable.status}::int ELSE NULL END`;
}

router.get("/dashboard/summary", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  // Aggregate tasks by stage type using a join with workflow_stages.
  // safeStatusInt() prevents a cast error when legacy string statuses are
  // still present in the database for this org.
  const taskTypeAgg = await db
    .select({
      type: workflowStagesTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(tasksTable)
    .innerJoin(
      workflowStagesTable,
      and(
        sql`${safeStatusInt()} = ${workflowStagesTable.id}`,
        eq(workflowStagesTable.orgId, orgId),
      ),
    )
    .where(eq(tasksTable.orgId, orgId))
    .groupBy(workflowStagesTable.type);

  const openCount = taskTypeAgg.find((r) => r.type === "open")?.count ?? 0;
  const closedCount = taskTypeAgg.find((r) => r.type === "closed")?.count ?? 0;
  const total = openCount + closedCount;

  // Per-stage breakdown (active stages only), ordered by position.
  // LEFT JOIN so every stage appears even with zero tasks.
  const stageBreakdown = await db
    .select({
      stageId: workflowStagesTable.id,
      stageName: workflowStagesTable.name,
      stageColor: workflowStagesTable.color,
      stageType: workflowStagesTable.type,
      count: sql<number>`count(${tasksTable.id})::int`,
    })
    .from(workflowStagesTable)
    .leftJoin(
      tasksTable,
      and(
        sql`${safeStatusInt()} = ${workflowStagesTable.id}`,
        eq(tasksTable.orgId, orgId),
      ),
    )
    .where(and(eq(workflowStagesTable.orgId, orgId), isNull(workflowStagesTable.archivedAt)))
    .groupBy(
      workflowStagesTable.id,
      workflowStagesTable.name,
      workflowStagesTable.color,
      workflowStagesTable.type,
      workflowStagesTable.position,
    )
    .orderBy(asc(workflowStagesTable.position));

  // Priority breakdown — counts all tasks regardless of status format
  const [taskStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      low: sql<number>`count(*) filter (where ${tasksTable.priority} = 'low')::int`,
      medium: sql<number>`count(*) filter (where ${tasksTable.priority} = 'medium')::int`,
      high: sql<number>`count(*) filter (where ${tasksTable.priority} = 'high')::int`,
      critical: sql<number>`count(*) filter (where ${tasksTable.priority} = 'critical')::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.orgId, orgId));

  // Overdue: past due date and in an open stage
  const today = new Date().toISOString().split("T")[0];
  const [overdueResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasksTable)
    .innerJoin(
      workflowStagesTable,
      and(
        sql`${safeStatusInt()} = ${workflowStagesTable.id}`,
        eq(workflowStagesTable.orgId, orgId),
        eq(workflowStagesTable.type, "open"),
      ),
    )
    .where(and(eq(tasksTable.orgId, orgId), lt(tasksTable.dueDate, today)));

  const [projectStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${projectsTable.status} = 'active')::int`,
    })
    .from(projectsTable)
    .where(eq(projectsTable.orgId, orgId));

  const summary = {
    totalTasks: taskStats?.total ?? total,
    totalProjects: projectStats?.total ?? 0,
    tasksByStageType: {
      open: openCount,
      closed: closedCount,
    },
    stageBreakdown: stageBreakdown.map((s) => ({
      stageId: s.stageId,
      stageName: s.stageName,
      stageColor: s.stageColor,
      stageType: s.stageType,
      count: s.count,
    })),
    tasksByPriority: {
      low: taskStats?.low ?? 0,
      medium: taskStats?.medium ?? 0,
      high: taskStats?.high ?? 0,
      critical: taskStats?.critical ?? 0,
    },
    overdueCount: overdueResult?.count ?? 0,
    activeProjects: projectStats?.active ?? 0,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

/**
 * Format a custom-field audit event (field prefixed with "cf:") into a
 * human-readable description — mirrors the cf: branch in task-detail.tsx.
 */
function cfEventDescription(field: string, oldValue: string | null, newValue: string | null): string {
  const cfName = field.slice(3); // strip "cf:" prefix
  if (!oldValue && newValue) return `${cfName} set to ${newValue}`;
  if (oldValue && !newValue) return `${cfName} cleared (was ${oldValue})`;
  return `${cfName} changed from ${oldValue ?? "—"} → ${newValue ?? "—"}`;
}

router.get("/dashboard/activity", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  const [recentTasks, recentComments, recentProjects, recentCfEvents] = await Promise.all([
    db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        createdAt: tasksTable.createdAt,
      })
      .from(tasksTable)
      .where(eq(tasksTable.orgId, orgId))
      .orderBy(sql`${tasksTable.createdAt} desc`)
      .limit(5),
    db
      .select({
        id: commentsTable.id,
        content: commentsTable.content,
        taskId: commentsTable.taskId,
        taskTitle: tasksTable.title,
        createdAt: commentsTable.createdAt,
      })
      .from(commentsTable)
      .innerJoin(tasksTable, eq(commentsTable.taskId, tasksTable.id))
      .where(eq(tasksTable.orgId, orgId))
      .orderBy(sql`${commentsTable.createdAt} desc`)
      .limit(5),
    db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        createdAt: projectsTable.createdAt,
      })
      .from(projectsTable)
      .where(eq(projectsTable.orgId, orgId))
      .orderBy(sql`${projectsTable.createdAt} desc`)
      .limit(5),
    // Custom-field changes stored in task_events with "cf:<fieldName>" field prefix.
    db
      .select({
        id: taskEventsTable.id,
        field: taskEventsTable.field,
        oldValue: taskEventsTable.oldValue,
        newValue: taskEventsTable.newValue,
        taskId: taskEventsTable.taskId,
        taskTitle: tasksTable.title,
        createdAt: taskEventsTable.createdAt,
      })
      .from(taskEventsTable)
      .innerJoin(tasksTable, eq(taskEventsTable.taskId, tasksTable.id))
      .where(and(eq(taskEventsTable.orgId, orgId), like(taskEventsTable.field, "cf:%")))
      .orderBy(sql`${taskEventsTable.createdAt} desc`)
      .limit(5),
  ]);
  const taskItems = recentTasks.map((t) => ({
    id: t.id,
    type: "task_created",
    title: `Task created: ${t.title}`,
    entityId: t.id,
    entityType: "task",
    createdAt: t.createdAt.toISOString(),
  }));

  const commentItems = recentComments.map((c) => ({
    id: c.id + 100000,
    type: "comment_added",
    title: `Comment on "${c.taskTitle}"`,
    entityId: c.taskId,
    entityType: "task",
    createdAt: c.createdAt.toISOString(),
  }));

  const projectItems = recentProjects.map((p) => ({
    id: p.id + 200000,
    type: "project_created",
    title: `Project created: ${p.name}`,
    entityId: p.id,
    entityType: "project",
    createdAt: p.createdAt.toISOString(),
  }));

  const cfEventItems = recentCfEvents.map((e) => ({
    id: e.id + 300000,
    type: "field_updated",
    title: `${cfEventDescription(e.field, e.oldValue, e.newValue)} on "${e.taskTitle}"`,
    entityId: e.taskId,
    entityType: "task",
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
  }));

  const combined = [...taskItems, ...commentItems, ...projectItems, ...cfEventItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  res.json(GetRecentActivityResponse.parse(combined));
});

const VALID_PERIODS = new Set(["7d", "30d", "90d", "all"]);

router.get("/dashboard/sla-summary", requireOrg, requireSlaTrackingFeature, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const rawPeriod = req.query.period as string | undefined;
  const period = rawPeriod ?? "30d";

  if (rawPeriod !== undefined && !VALID_PERIODS.has(rawPeriod)) {
    res.status(400).json({ error: "Invalid period. Must be one of: 7d, 30d, 90d, all." });
    return;
  }

  // Build the period filter applied to task.createdAt
  const periodFilter = (() => {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
    if (days === null) return null; // "all" — no date restriction
    return gte(tasksTable.createdAt, sql`NOW() - (${days} * INTERVAL '1 day')`);
  })();

  // Query 1 — breached tasks grouped by priority, plus avg overshoot in minutes.
  //
  // slaBreachedAt is stamped when EITHER the response OR the resolution SLA
  // deadline is crossed first. To compute the correct overshoot we subtract the
  // earliest configured threshold — i.e. the one that would fire first.
  //
  //   effective_threshold = CASE
  //     WHEN both are set  → LEAST(responseMinutes, resolutionMinutes)
  //     WHEN only response → responseMinutes
  //     WHEN only resolut. → resolutionMinutes
  //   END
  //
  // We then clamp with GREATEST(..., 0) so a breach detected one polling tick
  // late never shows a negative overshoot.
  //
  // LEFT JOIN with org-level policy so tasks whose policy was later deleted
  // still count as breached (they just contribute NULL to the avg overshoot).
  //
  // NOTE — project-level policy overrides: slaBreachedAt is always set
  // correctly by the poller (it uses the project override when present), so
  // breachedCount and complianceRate are accurate for all tasks. The
  // avgBreachMinutes calculation, however, uses the org-level resolutionMinutes
  // as the reference threshold. For tasks whose project-level override is
  // *stricter* than the org policy, the computed overshoot is clamped to 0 by
  // GREATEST(..., 0), so avgBreachMinutes may be slightly under-reported when
  // such tasks are present. Fixing this would require a self-join with aliases
  // to COALESCE project and org thresholds, which is deferred to a future task.
  const breachedRows = await db
    .select({
      priority: tasksTable.priority,
      breachedCount: sql<number>`count(*)::int`,
      avgBreachMinutes: sql<number | null>`avg(
        CASE
          WHEN ${slaPoliciesTable.responseMinutes} IS NOT NULL
            OR ${slaPoliciesTable.resolutionMinutes} IS NOT NULL
          THEN GREATEST(
            EXTRACT(EPOCH FROM (${tasksTable.slaBreachedAt} - ${tasksTable.createdAt})) / 60.0
            - (CASE
                 WHEN ${slaPoliciesTable.responseMinutes} IS NOT NULL
                   AND ${slaPoliciesTable.resolutionMinutes} IS NOT NULL
                 THEN LEAST(${slaPoliciesTable.responseMinutes}, ${slaPoliciesTable.resolutionMinutes})
                 WHEN ${slaPoliciesTable.responseMinutes} IS NOT NULL
                 THEN ${slaPoliciesTable.responseMinutes}
                 ELSE ${slaPoliciesTable.resolutionMinutes}
               END),
            0.0
          )
          ELSE NULL
        END
      )`,
    })
    .from(tasksTable)
    .leftJoin(
      slaPoliciesTable,
      and(
        eq(slaPoliciesTable.orgId, orgId),
        eq(slaPoliciesTable.priority, tasksTable.priority),
        isNull(slaPoliciesTable.projectId),
      ),
    )
    .where(
      and(
        eq(tasksTable.orgId, orgId),
        isNotNull(tasksTable.slaBreachedAt),
        ...(periodFilter ? [periodFilter] : []),
      ),
    )
    .groupBy(tasksTable.priority);

  // Query 2 — tasks resolved cleanly (closed stage, no breach, has an org SLA policy).
  // INNER JOIN on org-level policy ensures we only count tasks that actually had
  // an SLA target; tasks without a policy are excluded from compliance tracking.
  const withinSlaRows = await db
    .select({
      priority: tasksTable.priority,
      withinSlaCount: sql<number>`count(*)::int`,
    })
    .from(tasksTable)
    .innerJoin(
      workflowStagesTable,
      and(
        sql`${safeStatusInt()} = ${workflowStagesTable.id}`,
        eq(workflowStagesTable.orgId, orgId),
        eq(workflowStagesTable.type, "closed"),
      ),
    )
    .innerJoin(
      slaPoliciesTable,
      and(
        eq(slaPoliciesTable.orgId, orgId),
        eq(slaPoliciesTable.priority, tasksTable.priority),
        isNull(slaPoliciesTable.projectId),
      ),
    )
    .where(
      and(
        eq(tasksTable.orgId, orgId),
        isNull(tasksTable.slaBreachedAt),
        ...(periodFilter ? [periodFilter] : []),
      ),
    )
    .groupBy(tasksTable.priority);

  // Merge per-priority results
  const priorities = ["low", "medium", "high", "critical"] as const;
  const byPriority = priorities.map((priority) => {
    const breached = breachedRows.find((r) => r.priority === priority);
    const withinSla = withinSlaRows.find((r) => r.priority === priority);
    const breachedCount = breached?.breachedCount ?? 0;
    const withinSlaCount = withinSla?.withinSlaCount ?? 0;
    const totalTracked = breachedCount + withinSlaCount;
    const complianceRate = totalTracked === 0 ? 100 : Math.round((withinSlaCount / totalTracked) * 1000) / 10;
    return { priority, totalTracked, breachedCount, complianceRate };
  });

  const totalBreached = breachedRows.reduce((sum, r) => sum + r.breachedCount, 0);
  const totalWithinSla = withinSlaRows.reduce((sum, r) => sum + r.withinSlaCount, 0);
  const totalTracked = totalBreached + totalWithinSla;
  const complianceRate = totalTracked === 0 ? 100 : Math.round((totalWithinSla / totalTracked) * 1000) / 10;

  // Weighted average of per-priority avg breach minutes (only for priorities that had breaches)
  const breachedWithAvg = breachedRows.filter(
    (r) => r.breachedCount > 0 && r.avgBreachMinutes != null,
  );
  const avgBreachMinutes =
    breachedWithAvg.length === 0
      ? null
      : breachedWithAvg.reduce((sum, r) => sum + Number(r.avgBreachMinutes) * r.breachedCount, 0) /
        breachedWithAvg.reduce((sum, r) => sum + r.breachedCount, 0);

  const payload = {
    complianceRate,
    totalTracked,
    withinSlaCount: totalWithinSla,
    breachedCount: totalBreached,
    avgBreachMinutes: avgBreachMinutes != null ? Math.round(avgBreachMinutes * 10) / 10 : null,
    byPriority,
  };

  res.json(GetDashboardSlaSummaryResponse.parse(payload));
});

export default router;
