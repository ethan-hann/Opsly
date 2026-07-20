import { Router, type IRouter } from "express";
import { eq, sql, and, isNull } from "drizzle-orm";
import { db, projectsTable, tasksTable, slaPoliciesTable } from "@workspace/db";
import { z } from "zod";
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
import { requireOrg, requirePermission } from "../middlewares/requireOrgMiddleware";
import { dispatchProjectCreated, dispatchProjectUpdated } from "../lib/webhook-dispatcher";

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

router.get("/projects", requireOrg, async (req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.orgId, req.orgId!))
    .orderBy(projectsTable.createdAt);

  const taskCounts = await db
    .select({
      projectId: tasksTable.projectId,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${tasksTable.status} = 'done')::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.orgId, req.orgId!))
    .groupBy(tasksTable.projectId);

  const countMap = new Map(taskCounts.map((r) => [r.projectId, r]));

  const result = projects.map((p) => {
    const counts = countMap.get(p.id);
    return serializeProject(p, counts?.total ?? 0, counts?.completed ?? 0);
  });

  res.json(ListProjectsResponse.parse(result));
});

router.post("/projects", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, orgId: req.orgId! })
    .returning();

  const serialized = serializeProject(project, 0, 0);
  dispatchProjectCreated(req.orgId!, serialized);
  res.status(201).json(CreateProjectResponse.parse(serialized));
});

router.get("/projects/:id", requireOrg, async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.orgId, req.orgId!)));

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
    .where(and(eq(tasksTable.projectId, project.id), eq(tasksTable.orgId, req.orgId!)));

  res.json(GetProjectResponse.parse(serializeProject(project, counts?.total ?? 0, counts?.completed ?? 0)));
});

router.patch("/projects/:id", requireOrg, async (req, res): Promise<void> => {
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
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.orgId, req.orgId!)))
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
    .where(and(eq(tasksTable.projectId, project.id), eq(tasksTable.orgId, req.orgId!)));

  const serializedUpdate = serializeProject(project, counts?.total ?? 0, counts?.completed ?? 0);
  dispatchProjectUpdated(req.orgId!, serializedUpdate);
  res.json(UpdateProjectResponse.parse(serializedUpdate));
});

router.delete("/projects/:id", requireOrg, async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .delete(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.orgId, req.orgId!)))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

// ─── Project SLA policy overrides ────────────────────────────────────────────

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;

const ProjectIdParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * GET /projects/:id/sla-policies
 * Returns the project-level SLA policy overrides for this project.
 * Omits org-level policies — the caller should merge as needed.
 */
router.get("/projects/:id/sla-policies", requireOrg, async (req, res): Promise<void> => {
  const params = ProjectIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const id = params.data.id;

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), eq(projectsTable.orgId, req.orgId!)))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const policies = await db
    .select()
    .from(slaPoliciesTable)
    .where(and(eq(slaPoliciesTable.orgId, req.orgId!), eq(slaPoliciesTable.projectId, id)));

  res.json(
    policies.map((p) => ({
      ...p,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    })),
  );
});

/**
 * PUT /projects/:id/sla-policies
 * Replace all SLA policy overrides for this project. Requires manage_sla_policies.
 * Send an empty policies array to clear all overrides (revert to org defaults).
 */
router.put(
  "/projects/:id/sla-policies",
  requireOrg,
  requirePermission("manage_sla_policies"),
  async (req, res): Promise<void> => {
    const projectParams = ProjectIdParams.safeParse(req.params);
    if (!projectParams.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const id = projectParams.data.id;

    const schema = z.object({
      policies: z
        .array(
          z.object({
            priority: z.enum(VALID_PRIORITIES),
            responseMinutes: z.number().int().min(1).nullable().optional(),
            resolutionMinutes: z.number().int().min(1).nullable().optional(),
          }),
        )
        .max(4),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const priorities = parsed.data.policies.map((p) => p.priority);
    if (new Set(priorities).size !== priorities.length) {
      res.status(400).json({ error: "Duplicate priority values are not allowed." });
      return;
    }

    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.orgId, req.orgId!)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const orgId = req.orgId!;

    // Delete existing project-level policies then re-insert
    await db
      .delete(slaPoliciesTable)
      .where(and(eq(slaPoliciesTable.orgId, orgId), eq(slaPoliciesTable.projectId, id)));

    const toInsert = parsed.data.policies.filter(
      (p) => p.responseMinutes != null || p.resolutionMinutes != null,
    );

    let result: (typeof slaPoliciesTable.$inferSelect)[] = [];
    if (toInsert.length > 0) {
      result = await db
        .insert(slaPoliciesTable)
        .values(
          toInsert.map((p) => ({
            orgId,
            projectId: id,
            priority: p.priority,
            responseMinutes: p.responseMinutes ?? null,
            resolutionMinutes: p.resolutionMinutes ?? null,
          })),
        )
        .returning();
    }

    res.json(
      result.map((p) => ({
        ...p,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
      })),
    );
  },
);

export default router;
