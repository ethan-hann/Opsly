import { Router, type IRouter } from "express";
import { eq, sql, and, isNull, lt } from "drizzle-orm";
import { db, tasksTable, projectsTable, commentsTable } from "@workspace/db";
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

const router: IRouter = Router();

async function buildTaskWithProject(task: typeof tasksTable.$inferSelect) {
  const [project] = task.projectId
    ? await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, task.projectId))
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

router.get("/tasks/overdue", async (req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(lt(tasksTable.dueDate, today), sql`${tasksTable.status} != 'done'`))
    .orderBy(tasksTable.dueDate);

  const result = await Promise.all(tasks.map(buildTaskWithProject));
  res.json(GetOverdueTasksResponse.parse(result));
});

router.get("/tasks", async (req, res): Promise<void> => {
  const queryParams = ListTasksQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { projectId, status, priority, category } = queryParams.data;

  const conditions = [];
  if (projectId != null) conditions.push(eq(tasksTable.projectId, projectId));
  if (status) conditions.push(eq(tasksTable.status, status));
  if (priority) conditions.push(eq(tasksTable.priority, priority));
  if (category) conditions.push(eq(tasksTable.category, category));

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(tasksTable.createdAt);

  const result = await Promise.all(tasks.map(buildTaskWithProject));
  res.json(ListTasksResponse.parse(result));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db.insert(tasksTable).values(parsed.data).returning();
  const enriched = await buildTaskWithProject(task);
  res.status(201).json(CreateTaskResponse.parse(enriched));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const enriched = await buildTaskWithProject(task);
  res.json(GetTaskResponse.parse(enriched));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
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

  const [task] = await db
    .update(tasksTable)
    .set(parsed.data)
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const enriched = await buildTaskWithProject(task);
  res.json(UpdateTaskResponse.parse(enriched));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id)).returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
