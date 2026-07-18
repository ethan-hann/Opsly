import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable } from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  ListProjectsResponse,
  CreateProjectResponse,
  GetProjectResponse,
  UpdateProjectResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeProject(p: typeof projectsTable.$inferSelect, taskCount = 0, completedTaskCount = 0) {
  return {
    ...p,
    dueDate: p.dueDate ?? null,
    description: p.description ?? null,
    taskCount,
    completedTaskCount,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  };
}

router.get("/projects", async (req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);

  // Attach task counts
  const taskCounts = await db
    .select({
      projectId: tasksTable.projectId,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'done')::int`,
    })
    .from(tasksTable)
    .groupBy(tasksTable.projectId);

  const countMap = new Map(taskCounts.map((r) => [r.projectId, r]));

  const result = projects.map((p) => {
    const counts = countMap.get(p.id);
    return serializeProject(p, counts?.total ?? 0, counts?.completed ?? 0);
  });

  res.json(ListProjectsResponse.parse(result));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db.insert(projectsTable).values(parsed.data).returning();

  res.status(201).json(CreateProjectResponse.parse(serializeProject(project, 0, 0)));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'done')::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, project.id));

  res.json(GetProjectResponse.parse(serializeProject(project, counts?.total ?? 0, counts?.completed ?? 0)));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .update(projectsTable)
    .set(parsed.data)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'done')::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, project.id));

  res.json(UpdateProjectResponse.parse(serializeProject(project, counts?.total ?? 0, counts?.completed ?? 0)));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
