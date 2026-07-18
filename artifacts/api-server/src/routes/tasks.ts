import { Router, type IRouter } from "express";
import { eq, sql, and, lt } from "drizzle-orm";
import { db, tasksTable, projectsTable, commentsTable, orgMembersTable, usersTable } from "@workspace/db";
import {
  CreateTaskBody,
  UpdateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  DeleteTaskParams,
  ListTasksQueryParams,
  ListTasksResponse,
  CreateTaskResponse,
  GetTaskResponse,
  UpdateTaskResponse,
  GetOverdueTasksResponse,
} from "@workspace/api-zod";
import { requireOrg } from "../middlewares/requireOrgMiddleware";

const router: IRouter = Router();

/**
 * Build enriched task payload.
 * Project lookup is scoped to orgId to prevent cross-tenant metadata leaks.
 */
async function buildTaskWithProject(
  task: typeof tasksTable.$inferSelect,
  orgId: string,
) {
  // Only expose project name if the project belongs to the same org
  const [project] = task.projectId
    ? await db
        .select({ name: projectsTable.name })
        .from(projectsTable)
        .where(
          and(
            eq(projectsTable.id, task.projectId),
            eq(projectsTable.orgId, orgId),
          ),
        )
    : [];

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentsTable)
    .where(eq(commentsTable.taskId, task.id));

  return {
    ...task,
    projectId: task.projectId ?? null,
    projectName: project?.name ?? null,
    description: task.description ?? null,
    assignee: task.assignee ?? null,
    dueDate: task.dueDate ?? null,
    commentCount: count ?? 0,
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
  };
}

/**
 * Verify a projectId belongs to the org. Returns false if it doesn't.
 */
async function projectBelongsToOrg(projectId: number, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
    .limit(1);
  return !!row;
}

/**
 * Verify an assignee email belongs to an org member. Returns false if not found.
 * A null/undefined assignee is always considered valid (unassigned).
 */
async function assigneeBelongsToOrg(assignee: string | null | undefined, orgId: string): Promise<boolean> {
  if (!assignee) return true;
  const [row] = await db
    .select({ userId: orgMembersTable.userId })
    .from(orgMembersTable)
    .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
    .where(and(eq(orgMembersTable.orgId, orgId), eq(usersTable.email, assignee)))
    .limit(1);
  return !!row;
}

router.get("/tasks/overdue", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const today = new Date().toISOString().split("T")[0];
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(
      eq(tasksTable.orgId, orgId),
      lt(tasksTable.dueDate, today),
      sql`${tasksTable.status} != 'done'`,
    ))
    .orderBy(tasksTable.dueDate);

  const result = await Promise.all(tasks.map((t) => buildTaskWithProject(t, orgId)));
  res.json(GetOverdueTasksResponse.parse(result));
});

router.get("/tasks", requireOrg, async (req, res): Promise<void> => {
  const queryParams = ListTasksQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const orgId = req.orgId!;
  const { projectId, status, priority, category } = queryParams.data;

  const conditions = [eq(tasksTable.orgId, orgId)];
  if (projectId != null) conditions.push(eq(tasksTable.projectId, projectId));
  if (status) conditions.push(eq(tasksTable.status, status));
  if (priority) conditions.push(eq(tasksTable.priority, priority));
  if (category) conditions.push(eq(tasksTable.category, category));

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(tasksTable.createdAt);

  const result = await Promise.all(tasks.map((t) => buildTaskWithProject(t, orgId)));
  res.json(ListTasksResponse.parse(result));
});

router.post("/tasks", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Validate that projectId (if provided) belongs to this org
  if (parsed.data.projectId != null) {
    const valid = await projectBelongsToOrg(parsed.data.projectId, orgId);
    if (!valid) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  // Validate that assignee (if provided) is an org member
  if (parsed.data.assignee) {
    const validAssignee = await assigneeBelongsToOrg(parsed.data.assignee, orgId);
    if (!validAssignee) {
      res.status(400).json({ error: "Assignee must be a member of your organization" });
      return;
    }
  }

  const [task] = await db
    .insert(tasksTable)
    .values({ ...parsed.data, orgId })
    .returning();

  const enriched = await buildTaskWithProject(task, orgId);
  res.status(201).json(CreateTaskResponse.parse(enriched));
});

router.get("/tasks/:id", requireOrg, async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const enriched = await buildTaskWithProject(task, orgId);
  res.json(GetTaskResponse.parse(enriched));
});

router.patch("/tasks/:id", requireOrg, async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Validate that projectId (if being changed) belongs to this org
  if (parsed.data.projectId != null) {
    const valid = await projectBelongsToOrg(parsed.data.projectId, orgId);
    if (!valid) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  // Validate that assignee (if being changed) is an org member
  if (parsed.data.assignee) {
    const validAssignee = await assigneeBelongsToOrg(parsed.data.assignee, orgId);
    if (!validAssignee) {
      res.status(400).json({ error: "Assignee must be a member of your organization" });
      return;
    }
  }

  const [task] = await db
    .update(tasksTable)
    .set(parsed.data)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const enriched = await buildTaskWithProject(task, orgId);
  res.json(UpdateTaskResponse.parse(enriched));
});

router.delete("/tasks/:id", requireOrg, async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const [task] = await db
    .delete(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
