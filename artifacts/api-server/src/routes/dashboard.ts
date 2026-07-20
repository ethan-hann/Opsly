import { Router, type IRouter } from "express";
import { eq, sql, lt, and, isNull, asc } from "drizzle-orm";
import { db, tasksTable, projectsTable, commentsTable, workflowStagesTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetRecentActivityResponse,
} from "@workspace/api-zod";
import { requireOrg } from "../middlewares/requireOrgMiddleware";

const router: IRouter = Router();

router.get("/dashboard/summary", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  // Aggregate tasks by stage type using a join with workflow_stages
  const taskTypeAgg = await db
    .select({
      type: workflowStagesTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(tasksTable)
    .innerJoin(
      workflowStagesTable,
      and(
        sql`${tasksTable.status}::int = ${workflowStagesTable.id}`,
        eq(workflowStagesTable.orgId, orgId),
      ),
    )
    .where(eq(tasksTable.orgId, orgId))
    .groupBy(workflowStagesTable.type);

  const openCount = taskTypeAgg.find((r) => r.type === "open")?.count ?? 0;
  const closedCount = taskTypeAgg.find((r) => r.type === "closed")?.count ?? 0;
  const total = openCount + closedCount;

  // Per-stage breakdown (active stages only), ordered by position
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
        sql`${tasksTable.status}::int = ${workflowStagesTable.id}`,
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

  // Priority breakdown
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
        sql`${tasksTable.status}::int = ${workflowStagesTable.id}`,
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

router.get("/dashboard/activity", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;

  const recentTasks = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .where(eq(tasksTable.orgId, orgId))
    .orderBy(sql`${tasksTable.createdAt} desc`)
    .limit(5);

  const recentComments = await db
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
    .limit(5);

  const recentProjects = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      createdAt: projectsTable.createdAt,
    })
    .from(projectsTable)
    .where(eq(projectsTable.orgId, orgId))
    .orderBy(sql`${projectsTable.createdAt} desc`)
    .limit(5);

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

  const combined = [...taskItems, ...commentItems, ...projectItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  res.json(GetRecentActivityResponse.parse(combined));
});

export default router;
