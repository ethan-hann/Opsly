import { Router, type IRouter } from "express";
import { eq, sql, and, isNotNull, desc } from "drizzle-orm";
import { db, projectsTable, tasksTable, slaPoliciesTable, projectSlaPolicyAuditTable, usersTable } from "@workspace/db";
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
import { requireOrgOrApiKey, requireOrg, requirePermission, requireScope, hasPermission } from "../middlewares/requireOrgMiddleware";
import { dispatchProjectCreated, dispatchProjectUpdated, dispatchProjectDeleted } from "../lib/webhook-dispatcher";
import { logOrgEvent } from "../lib/log-org-event";
import { broadcastToOrg } from "../lib/sse";

const router: IRouter = Router();

// ─── Actor resolution ─────────────────────────────────────────────────────────

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return full || user.email || "Unknown";
}

/**
 * Derive the actor identity for audit events from the current request.
 *
 *  Session auth  → actorId = user.id, actorName = display name
 *  API key auth  → actorId = key ID,  actorName = "API key: <key name>"
 *  Neither       → both null
 */
function resolveActor(req: {
  user?: { id?: string; firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  apiKeyId?: string;
  apiKeyName?: string;
}): { actorId: string | null; actorName: string | null } {
  if (req.user) {
    return { actorId: req.user.id ?? null, actorName: displayName(req.user) };
  }
  if (req.apiKeyId) {
    return {
      actorId: req.apiKeyId,
      actorName: `API key: ${req.apiKeyName ?? req.apiKeyId}`,
    };
  }
  return { actorId: null, actorName: null };
}

function serializeProject(p: typeof projectsTable.$inferSelect, taskCount = 0, completedTaskCount = 0, hasSlaOverrides = false, createdByName: string | null = null) {
  return {
    ...p,
    dueDate: p.dueDate ?? null,
    description: p.description ?? null,
    taskCount,
    completedTaskCount,
    hasSlaOverrides,
    createdByName,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  };
}

const closedStageSubquery = (orgId: string) =>
  sql`select id from "workflow_stages" where "org_id" = ${orgId} and "type" = 'closed'`;

router.get("/projects", requireOrgOrApiKey, requireScope("projects:read"), async (req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.orgId, req.orgId!))
    .orderBy(projectsTable.createdAt);

  const orgId = req.orgId!;
  const [taskCounts, slaOverrideRows] = await Promise.all([
    db
      .select({
        projectId: tasksTable.projectId,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where (${tasksTable.status} ~ ${'^[0-9]+$'} AND ${tasksTable.status}::int in (${closedStageSubquery(orgId)})))::int`,
      })
      .from(tasksTable)
      .where(eq(tasksTable.orgId, orgId))
      .groupBy(tasksTable.projectId),
    db
      .select({ projectId: slaPoliciesTable.projectId })
      .from(slaPoliciesTable)
      .where(and(eq(slaPoliciesTable.orgId, orgId), isNotNull(slaPoliciesTable.projectId)))
      .groupBy(slaPoliciesTable.projectId),
  ]);

  const countMap = new Map(taskCounts.map((r) => [r.projectId, r]));
  const slaOverrideSet = new Set(slaOverrideRows.map((r) => r.projectId));

  const result = projects.map((p) => {
    const counts = countMap.get(p.id);
    return serializeProject(p, counts?.total ?? 0, counts?.completed ?? 0, slaOverrideSet.has(p.id));
  });

  res.json(ListProjectsResponse.parse(result));
});

router.post("/projects", requireOrgOrApiKey, requireScope("projects:write"), async (req, res): Promise<void> => {
  if (!hasPermission(req, "manage_projects")) {
    res.status(403).json({ error: "Permission required: manage_projects" });
    return;
  }
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const creatorId = req.user?.id ?? null;
  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, orgId: req.orgId!, createdBy: creatorId })
    .returning();

  const creatorName = req.user ? displayName(req.user) : null;
  const serialized = serializeProject(project, 0, 0, false, creatorName);
  dispatchProjectCreated(req.orgId!, serialized);
  broadcastToOrg(req.orgId!, "project-changed", { projectId: project.id, action: "created" });

  const { actorId: pActorId, actorName: pActorName } = resolveActor(req);
  void logOrgEvent({
    orgId: req.orgId!,
    actorId: pActorId,
    actorName: pActorName,
    category: 'project',
    action: 'project.created',
    targetId: String(project.id),
    targetName: project.name,
    metadata: null,
  });

  res.status(201).json(CreateProjectResponse.parse(serialized));
});

router.get("/projects/:id", requireOrgOrApiKey, requireScope("projects:read"), async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({ project: projectsTable, creatorFirstName: usersTable.firstName, creatorLastName: usersTable.lastName, creatorEmail: usersTable.email })
    .from(projectsTable)
    .leftJoin(usersTable, eq(projectsTable.createdBy, usersTable.id))
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.orgId, req.orgId!)));

  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { project, creatorFirstName, creatorLastName, creatorEmail } = row;
  const createdByName = creatorFirstName || creatorLastName || creatorEmail
    ? displayName({ firstName: creatorFirstName, lastName: creatorLastName, email: creatorEmail })
    : null;

  const getOrgId = req.orgId!;
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where (${tasksTable.status} ~ ${'^[0-9]+$'} AND ${tasksTable.status}::int in (${closedStageSubquery(getOrgId)})))::int`,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.projectId, project.id), eq(tasksTable.orgId, getOrgId)));

  res.json(GetProjectResponse.parse(serializeProject(project, counts?.total ?? 0, counts?.completed ?? 0, false, createdByName)));
});

router.patch("/projects/:id", requireOrgOrApiKey, requireScope("projects:write"), async (req, res): Promise<void> => {
  if (!hasPermission(req, "manage_projects")) {
    res.status(403).json({ error: "Permission required: manage_projects" });
    return;
  }
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

  const patchOrgId = req.orgId!;
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where (${tasksTable.status} ~ ${'^[0-9]+$'} AND ${tasksTable.status}::int in (${closedStageSubquery(patchOrgId)})))::int`,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.projectId, project.id), eq(tasksTable.orgId, patchOrgId)));

  const serializedUpdate = serializeProject(project, counts?.total ?? 0, counts?.completed ?? 0);
  dispatchProjectUpdated(req.orgId!, serializedUpdate);
  broadcastToOrg(req.orgId!, "project-changed", { projectId: project.id, action: "updated" });

  const { actorId: upActorId, actorName: upActorName } = resolveActor(req);
  void logOrgEvent({
    orgId: req.orgId!,
    actorId: upActorId,
    actorName: upActorName,
    category: 'project',
    action: 'project.updated',
    targetId: String(project.id),
    targetName: project.name,
    metadata: Object.keys(parsed.data).length > 0 ? parsed.data as Record<string, unknown> : null,
  });

  res.json(UpdateProjectResponse.parse(serializedUpdate));
});

router.delete("/projects/:id", requireOrgOrApiKey, requireScope("projects:write"), async (req, res): Promise<void> => {
  if (!hasPermission(req, "manage_projects")) {
    res.status(403).json({ error: "Permission required: manage_projects" });
    return;
  }
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

  dispatchProjectDeleted(req.orgId!, { id: project.id, name: project.name });
  broadcastToOrg(req.orgId!, "project-changed", { projectId: project.id, action: "deleted" });

  const { actorId: delActorId, actorName: delActorName } = resolveActor(req);
  void logOrgEvent({
    orgId: req.orgId!,
    actorId: delActorId,
    actorName: delActorName,
    category: 'project',
    action: 'project.deleted',
    targetId: String(project.id),
    targetName: project.name,
    metadata: null,
  });

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
router.get("/projects/:id/sla-policies", requireOrgOrApiKey, requireScope("projects:read"), async (req, res): Promise<void> => {
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
  requireOrgOrApiKey,
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
            warningThresholdPercent: z.number().int().min(1).max(99).optional(),
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

    // Snapshot previous policies before overwriting
    const previousPolicies = await db
      .select()
      .from(slaPoliciesTable)
      .where(and(eq(slaPoliciesTable.orgId, orgId), eq(slaPoliciesTable.projectId, id)));

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
            warningThresholdPercent: p.warningThresholdPercent ?? 80,
          })),
        )
        .returning();
    }

    // Write audit record
    const { actorId, actorName } = resolveActor(req);
    void logOrgEvent({
      orgId,
      actorId,
      actorName,
      category: 'project',
      action: 'project.sla_policies_updated',
      targetId: String(id),
      targetName: null,
      metadata: { projectId: id, count: result.length },
    });
    const serializePolicy = (p: typeof slaPoliciesTable.$inferSelect) => ({
      priority: p.priority,
      responseMinutes: p.responseMinutes,
      resolutionMinutes: p.resolutionMinutes,
      warningThresholdPercent: p.warningThresholdPercent,
    });
    await db.insert(projectSlaPolicyAuditTable).values({
      orgId,
      projectId: id,
      actorId,
      actorName,
      previousPolicies: previousPolicies.map(serializePolicy),
      newPolicies: result.map(serializePolicy),
    });

    res.json(
      result.map((p) => ({
        ...p,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
      })),
    );
  },
);

/**
 * GET /projects/:id/sla-policy-audit
 * Returns the SLA policy change history for a project in reverse-chronological
 * order (newest first, up to 50 entries). Requires view_audit_log OR
 * manage_sla_policies permission.
 */
router.get(
  "/projects/:id/sla-policy-audit",
  requireOrg,  // session-only — API keys are blocked by design; audit logs are not a key-accessible resource
  async (req, res): Promise<void> => {
    if (!hasPermission(req, "view_audit_log") && !hasPermission(req, "manage_sla_policies")) {
      res.status(403).json({ error: "Permission required: view_audit_log" });
      return;
    }

    const params = ProjectIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const id = params.data.id;
    const orgId = req.orgId!;

    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.orgId, orgId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const entries = await db
      .select()
      .from(projectSlaPolicyAuditTable)
      .where(
        and(
          eq(projectSlaPolicyAuditTable.orgId, orgId),
          eq(projectSlaPolicyAuditTable.projectId, id),
        ),
      )
      .orderBy(desc(projectSlaPolicyAuditTable.createdAt))
      .limit(50);

    res.json(
      entries.map((e) => ({
        ...e,
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
      })),
    );
  },
);

export default router;
