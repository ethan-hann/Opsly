import { Router, type IRouter } from "express";
import { eq, sql, and, lt, lte, gte, or, isNull, isNotNull, asc, desc, inArray } from "drizzle-orm";
import {
  db, tasksTable, projectsTable, commentsTable, orgMembersTable, usersTable,
  customFieldDefinitionsTable, taskEventsTable, slaPoliciesTable, workflowStagesTable,
  taskWatchersTable,
} from "@workspace/db";
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
  ListTaskEventsParams,
  ListTaskEventsResponse,
  BulkUpdateTasksBody,
  BulkUpdateTasksResponse,
  BulkDeleteTasksBody,
  BulkDeleteTasksResponse,
  WatchTaskParams,
  UnwatchTaskParams,
  GetTaskWatchersParams,
  GetTaskWatchersResponse,
  WatchTaskResponse,
  UnwatchTaskResponse,
  WatchingFilterParam,
} from "@workspace/api-zod";
import { requireOrgOrApiKey, requireScope, hasPermission } from "../middlewares/requireOrgMiddleware";
import { dispatchTaskCreated, dispatchTaskUpdated, dispatchTaskDeleted } from "../lib/webhook-dispatcher";
import { sanitizeRichText } from "../lib/sanitize-rich-text";
import { resolveCustomFieldNames } from "../lib/resolve-custom-fields";
import { detectAndMarkSlaBreaches } from "../lib/sla-detection";
import {
  notifyTaskAssigned,
  notifyTaskUpdated,
} from "../lib/notifications";

const router: IRouter = Router();


// ─── Stage helpers ────────────────────────────────────────────────────────────

type StageRow = typeof workflowStagesTable.$inferSelect;
type StagesMap = Map<number, StageRow>;

/** Fetch all workflow stages for an org as a Map keyed by ID. */
async function getOrgStages(orgId: string): Promise<StagesMap> {
  const stages = await db
    .select()
    .from(workflowStagesTable)
    .where(eq(workflowStagesTable.orgId, orgId));
  return new Map(stages.map((s) => [s.id, s]));
}

/**
 * Validate a status string (stage ID) against the org's stages.
 * Returns { ok: true, stage } or { ok: false, error }.
 */
async function resolveStage(
  stageIdStr: string,
  orgId: string,
  opts: { allowArchived?: boolean } = {},
): Promise<{ ok: true; stage: StageRow } | { ok: false; error: string }> {
  const id = parseInt(stageIdStr, 10);
  if (isNaN(id)) return { ok: false, error: `Invalid stage ID: "${stageIdStr}"` };
  const [stage] = await db
    .select()
    .from(workflowStagesTable)
    .where(and(eq(workflowStagesTable.id, id), eq(workflowStagesTable.orgId, orgId)))
    .limit(1);
  if (!stage) return { ok: false, error: "Workflow stage not found" };
  if (!opts.allowArchived && stage.archivedAt != null) {
    return { ok: false, error: "Cannot assign to an archived stage" };
  }
  return { ok: true, stage };
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildTaskWithProject(
  task: typeof tasksTable.$inferSelect,
  orgId: string,
  stages?: StagesMap,
) {
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

  // Resolve stage info
  const stageId = parseInt(task.status, 10);
  const stage = !isNaN(stageId) ? stages?.get(stageId) : undefined;

  return {
    ...task,
    projectId: task.projectId ?? null,
    projectName: project?.name ?? null,
    description: task.description ?? null,
    assignee: task.assignee ?? null,
    dueDate: task.dueDate ?? null,
    commentCount: count ?? 0,
    customFields: task.customFields ?? {},
    slaBreachedAt: task.slaBreachedAt instanceof Date ? task.slaBreachedAt.toISOString() : (task.slaBreachedAt ?? null),
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
    // Stage enrichment
    stageId: stage?.id ?? (isNaN(stageId) ? undefined : stageId),
    stageName: stage?.name ?? task.status,
    stageColor: stage?.color ?? "#6b7280",
    stageType: stage?.type ?? "open",
    stageArchived: stage?.archivedAt != null,
  };
}

async function validateAndSanitizeCustomFields(
  customFields: Record<string, unknown>,
  orgId: string,
): Promise<{ error: string; sanitized?: never } | { error?: never; sanitized: Record<string, unknown> }> {
  if (!customFields || Object.keys(customFields).length === 0) {
    return { sanitized: {} };
  }

  const definitions = await db
    .select()
    .from(customFieldDefinitionsTable)
    .where(and(eq(customFieldDefinitionsTable.orgId, orgId), isNull(customFieldDefinitionsTable.deletedAt)));

  const defMap = new Map(definitions.map((d) => [String(d.id), d]));
  const sanitized: Record<string, unknown> = {};

  for (const [fieldId, value] of Object.entries(customFields)) {
    const def = defMap.get(fieldId);
    if (!def) continue;

    if (value === null || value === undefined) {
      sanitized[fieldId] = null;
      continue;
    }

    switch (def.type) {
      case "text":
        if (typeof value !== "string") {
          return { error: `Custom field "${def.name}" expects a text (string) value` };
        }
        break;
      case "number":
        if (typeof value !== "number" && !(typeof value === "string" && value !== "" && !isNaN(Number(value)))) {
          return { error: `Custom field "${def.name}" expects a number` };
        }
        break;
      case "date":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { error: `Custom field "${def.name}" expects a date in YYYY-MM-DD format` };
        }
        break;
      case "single_select": {
        const options = (def.options as string[]) ?? [];
        if (typeof value !== "string" || !options.includes(value)) {
          return { error: `Custom field "${def.name}" value must be one of: ${options.join(", ")}` };
        }
        break;
      }
      case "multi_select": {
        const options = (def.options as string[]) ?? [];
        if (!Array.isArray(value)) {
          return { error: `Custom field "${def.name}" expects an array of selected values` };
        }
        for (const v of value as unknown[]) {
          if (typeof v !== "string" || !options.includes(v)) {
            return { error: `Custom field "${def.name}" contains invalid option: ${String(v)}` };
          }
        }
        break;
      }
    }

    sanitized[fieldId] = value;
  }

  return { sanitized };
}

async function projectBelongsToOrg(projectId: number, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
    .limit(1);
  return !!row;
}

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

/** Resolve an assignee email to a user ID within the org. Returns null if not found. */
async function resolveAssigneeUserId(assignee: string | null | undefined, orgId: string): Promise<string | null> {
  if (!assignee) return null;
  const [row] = await db
    .select({ userId: orgMembersTable.userId })
    .from(orgMembersTable)
    .innerJoin(usersTable, eq(orgMembersTable.userId, usersTable.id))
    .where(and(eq(orgMembersTable.orgId, orgId), eq(usersTable.email, assignee)))
    .limit(1);
  return row?.userId ?? null;
}

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return full || user.email || "Unknown";
}

/**
 * Derive the actor identity for audit events from the current request.
 *
 *  Session auth  → actorId = user.id, actorName = display name
 *  API key auth  → actorId = key ID,  actorName = "API key: <key name>"
 *  Neither       → both null (system-generated events such as SLA breaches)
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

const TRACKED_FIELDS = ["status", "priority", "assignee", "category", "title", "dueDate", "projectId"] as const;
type TrackedField = typeof TRACKED_FIELDS[number];
type TaskSnapshot = Pick<typeof tasksTable.$inferSelect, TrackedField>;

/**
 * Insert audit events for changed fields.
 * For status changes, stage names are stored (not IDs) via stagesMap.
 */
async function insertChangeEvents(
  taskId: number,
  orgId: string,
  actorId: string | null,
  actorName: string | null,
  prev: TaskSnapshot,
  next: TaskSnapshot,
  stagesMap?: StagesMap,
): Promise<void> {
  const events: Array<typeof taskEventsTable.$inferInsert> = [];

  const resolveStageName = (val: string | null): string | null => {
    if (val == null) return null;
    const id = parseInt(val, 10);
    if (!isNaN(id) && stagesMap) {
      return stagesMap.get(id)?.name ?? val;
    }
    return val;
  };

  for (const field of TRACKED_FIELDS) {
    const oldVal = prev[field];
    const newVal = next[field];
    const oldNorm = oldVal ?? null;
    const newNorm = newVal ?? null;
    if (oldNorm === newNorm) continue;

    const oldStr = oldNorm !== null ? String(oldNorm) : null;
    const newStr = newNorm !== null ? String(newNorm) : null;

    events.push({
      taskId,
      orgId,
      actorId,
      actorName,
      field,
      // For status field, record human-readable stage names (not IDs)
      oldValue: field === "status" ? resolveStageName(oldStr) : oldStr,
      newValue: field === "status" ? resolveStageName(newStr) : newStr,
    });
  }

  if (events.length > 0) {
    await db.insert(taskEventsTable).values(events);
  }
}

// ─── Watcher helpers ─────────────────────────────────────────────────────────

/**
 * Return all user IDs watching a given task.
 * Used to fan out notifications after task changes and new comments.
 */
async function getWatcherUserIds(taskId: number): Promise<string[]> {
  const rows = await db
    .select({ userId: taskWatchersTable.userId })
    .from(taskWatchersTable)
    .where(eq(taskWatchersTable.taskId, taskId));
  return rows.map((r) => r.userId);
}

/**
 * Upsert a watcher row (idempotent — safe to call even if already watching).
 */
async function upsertWatcher(taskId: number, userId: string, orgId: string): Promise<void> {
  await db
    .insert(taskWatchersTable)
    .values({ taskId, userId, orgId })
    .onConflictDoNothing();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get("/tasks/overdue", requireOrgOrApiKey, requireScope("tasks:read"), async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const today = new Date().toISOString().split("T")[0];

  // Join with workflow_stages to filter by stage type "open"
  const tasks = await db
    .select({ task: tasksTable })
    .from(tasksTable)
    .innerJoin(
      workflowStagesTable,
      and(
        sql`${tasksTable.status}::int = ${workflowStagesTable.id}`,
        eq(workflowStagesTable.orgId, orgId),
        eq(workflowStagesTable.type, "open"),
      ),
    )
    .where(and(
      eq(tasksTable.orgId, orgId),
      or(
        lt(tasksTable.dueDate, today),
        eq(tasksTable.priority, "critical"),
      ),
    ))
    .orderBy(tasksTable.dueDate);

  const taskRows = tasks.map((r) => r.task);
  const stages = taskRows.length > 0 ? await getOrgStages(orgId) : new Map();
  const result = await Promise.all(taskRows.map((t) => buildTaskWithProject(t, orgId, stages)));
  res.json(GetOverdueTasksResponse.parse(result));
});

// Performance note: this route relies on B-tree indexes on tasks.org_id,
// tasks.status, tasks.priority, tasks.category, tasks.assignee,
// tasks.project_id, tasks.due_date, and the composite (org_id, created_at)
// index for the default sort. Run migrate:add-task-list-btree-indexes before
// deploying to production to avoid sequential scans at scale.
router.get("/tasks", requireOrgOrApiKey, requireScope("tasks:read"), async (req, res): Promise<void> => {
  const queryParams = ListTasksQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }
  const watchingParam = WatchingFilterParam.safeParse(req.query);

  const orgId = req.orgId!;
  const { projectId, status, priority, category, assignee, dateFrom, dateTo, slaBreached } = queryParams.data;
  const watchingOnly = watchingParam.success && watchingParam.data.watching === true;

  const conditions = [eq(tasksTable.orgId, orgId)];
  if (projectId != null) conditions.push(eq(tasksTable.projectId, projectId));
  if (status) conditions.push(eq(tasksTable.status, status));
  if (priority) conditions.push(eq(tasksTable.priority, priority));
  if (category) conditions.push(eq(tasksTable.category, category));
  if (assignee) conditions.push(eq(tasksTable.assignee, assignee));
  if (dateFrom) conditions.push(gte(tasksTable.dueDate, dateFrom));
  if (dateTo) conditions.push(lte(tasksTable.dueDate, dateTo));
  if (slaBreached === "true") conditions.push(isNotNull(tasksTable.slaBreachedAt));

  let tasks: (typeof tasksTable.$inferSelect)[];

  if (watchingOnly && req.user?.id) {
    // Join with task_watchers to return only tasks the current user watches
    const rows = await db
      .select({ task: tasksTable })
      .from(tasksTable)
      .innerJoin(
        taskWatchersTable,
        and(
          eq(taskWatchersTable.taskId, tasksTable.id),
          eq(taskWatchersTable.userId, req.user.id),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(tasksTable.createdAt));
    tasks = rows.map((r) => r.task);
  } else {
    tasks = await db
      .select()
      .from(tasksTable)
      .where(and(...conditions))
      .orderBy(desc(tasksTable.createdAt));
  }

  const stages = tasks.length > 0 ? await getOrgStages(orgId) : new Map();

  const slaPolicies = tasks.length > 0
    ? await db.select().from(slaPoliciesTable).where(eq(slaPoliciesTable.orgId, orgId))
    : [];

  void detectAndMarkSlaBreaches(tasks, orgId, slaPolicies, stages);

  const result = await Promise.all(tasks.map((t) => buildTaskWithProject(t, orgId, stages)));
  res.json(ListTasksResponse.parse(result));
});

router.post("/tasks", requireOrgOrApiKey, requireScope("tasks:write"), async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  if (!hasPermission(req, "create_tasks")) {
    res.status(403).json({ error: "You do not have permission to create tasks" });
    return;
  }

  // Validate the stage ID
  const stageResult = await resolveStage(parsed.data.status, orgId);
  if (!stageResult.ok) {
    res.status(400).json({ error: stageResult.error });
    return;
  }

  // Closing a task requires the close_tasks permission
  if (stageResult.stage.type === "closed" && !hasPermission(req, "close_tasks")) {
    res.status(403).json({ error: "You do not have permission to create tasks in a closed stage" });
    return;
  }

  if (parsed.data.projectId != null) {
    const valid = await projectBelongsToOrg(parsed.data.projectId, orgId);
    if (!valid) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  if (parsed.data.assignee) {
    const validAssignee = await assigneeBelongsToOrg(parsed.data.assignee, orgId);
    if (!validAssignee) {
      res.status(400).json({ error: "Assignee must be a member of your organization" });
      return;
    }
  }

  let sanitizedCustomFields: Record<string, unknown> | undefined;
  if (parsed.data.customFields) {
    const result = await validateAndSanitizeCustomFields(
      parsed.data.customFields as Record<string, unknown>,
      orgId,
    );
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    sanitizedCustomFields = result.sanitized;
  }

  const [{ nextNum }] = await db
    .select({ nextNum: sql<number>`COALESCE(MAX(${tasksTable.orgTaskNumber}), 0) + 1` })
    .from(tasksTable)
    .where(eq(tasksTable.orgId, orgId));

  const { customFields: _rawCf, ...restCreateData } = parsed.data;
  // Sanitize rich-text HTML before persistence (blocks stored XSS)
  const sanitizedDescription = sanitizeRichText(restCreateData.description ?? null);
  const [task] = await db
    .insert(tasksTable)
    .values({
      ...restCreateData,
      orgId,
      orgTaskNumber: nextNum,
      description: sanitizedDescription,
      ...(sanitizedCustomFields !== undefined ? { customFields: sanitizedCustomFields } : {}),
    })
    .returning();

  const { actorId, actorName: actorNameStr } = resolveActor(req);
  await db.insert(taskEventsTable).values({
    taskId: task.id,
    orgId,
    actorId,
    actorName: actorNameStr,
    field: "created",
    oldValue: null,
    newValue: task.title,
  });

  const stagesMap = await getOrgStages(orgId);
  const enriched = await buildTaskWithProject(task, orgId, stagesMap);
  const webhookCustomFields = await resolveCustomFieldNames(enriched.customFields as Record<string, unknown>, orgId);
  dispatchTaskCreated(orgId, task.projectId, { ...enriched, customFields: webhookCustomFields });

  // Auto-watch the assignee + fire assignment notification (fire-and-forget)
  if (task.assignee) {
    void resolveAssigneeUserId(task.assignee, orgId).then(async (assigneeUserId) => {
      if (assigneeUserId) {
        await upsertWatcher(task.id, assigneeUserId, orgId);
        notifyTaskAssigned({
          taskId: task.id,
          taskTitle: task.title,
          orgId,
          actorId,
          actorName: actorNameStr,
          newAssigneeUserId: assigneeUserId,
        });
      }
    });
  }

  res.status(201).json(CreateTaskResponse.parse(enriched));
});

router.get("/tasks/:id", requireOrgOrApiKey, requireScope("tasks:read"), async (req, res): Promise<void> => {
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

  const [stages, slaPolicies] = await Promise.all([
    getOrgStages(orgId),
    db.select().from(slaPoliciesTable).where(eq(slaPoliciesTable.orgId, orgId)),
  ]);

  void detectAndMarkSlaBreaches([task], orgId, slaPolicies, stages);

  const enriched = await buildTaskWithProject(task, orgId, stages);
  res.json(GetTaskResponse.parse(enriched));
});

// ─── Bulk update ─────────────────────────────────────────────────────────────

router.patch("/tasks/bulk", requireOrgOrApiKey, requireScope("tasks:write"), async (req, res): Promise<void> => {
  const parsed = BulkUpdateTasksBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  if (!hasPermission(req, "edit_tasks")) {
    res.status(403).json({ error: "You do not have permission to edit tasks" });
    return;
  }

  const { ids, patch } = parsed.data;
  if (ids.length === 0) {
    res.json(BulkUpdateTasksResponse.parse({ updated: 0 }));
    return;
  }

  // Validate the target stage (if status is being changed) and enforce close_tasks permission
  if (patch.status !== undefined) {
    const stageResult = await resolveStage(patch.status, orgId);
    if (!stageResult.ok) {
      res.status(400).json({ error: stageResult.error });
      return;
    }
    if (stageResult.stage.type === "closed" && !hasPermission(req, "close_tasks")) {
      res.status(403).json({ error: "You do not have permission to close tasks" });
      return;
    }
  }

  if (patch.assignee) {
    const validAssignee = await assigneeBelongsToOrg(patch.assignee, orgId);
    if (!validAssignee) {
      res.status(400).json({ error: "Assignee must be a member of your organization" });
      return;
    }
  }

  const prevRows = await db
    .select({
      id: tasksTable.id,
      status: tasksTable.status,
      priority: tasksTable.priority,
      assignee: tasksTable.assignee,
      category: tasksTable.category,
      title: tasksTable.title,
      dueDate: tasksTable.dueDate,
      projectId: tasksTable.projectId,
    })
    .from(tasksTable)
    .where(and(inArray(tasksTable.id, ids), eq(tasksTable.orgId, orgId)));

  if (prevRows.length === 0) {
    res.json(BulkUpdateTasksResponse.parse({ updated: 0 }));
    return;
  }

  const setData: Partial<typeof tasksTable.$inferInsert> = {};
  if (patch.status !== undefined) setData.status = patch.status;
  if (patch.priority !== undefined) setData.priority = patch.priority;
  if (patch.category !== undefined) setData.category = patch.category;
  if ("assignee" in patch) setData.assignee = patch.assignee ?? null;

  const orgIds = prevRows.map((r) => r.id);
  await db
    .update(tasksTable)
    .set(setData)
    .where(and(inArray(tasksTable.id, orgIds), eq(tasksTable.orgId, orgId)));

  const { actorId, actorName: actorNameStr } = resolveActor(req);
  const stagesMap = await getOrgStages(orgId);

  for (const prev of prevRows) {
    const next = {
      status: patch.status ?? prev.status,
      priority: patch.priority ?? prev.priority,
      assignee: "assignee" in patch ? (patch.assignee ?? null) : prev.assignee,
      category: patch.category ?? prev.category,
      title: prev.title,
      dueDate: prev.dueDate,
      projectId: prev.projectId,
    };
    await insertChangeEvents(prev.id, orgId, actorId, actorNameStr, prev, next, stagesMap);
  }

  res.json(BulkUpdateTasksResponse.parse({ updated: prevRows.length }));
});

router.patch("/tasks/:id", requireOrgOrApiKey, requireScope("tasks:write"), async (req, res): Promise<void> => {
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

  if (!hasPermission(req, "edit_tasks")) {
    res.status(403).json({ error: "You do not have permission to edit tasks" });
    return;
  }

  // Validate and resolve the target stage (if status is being changed)
  if (parsed.data.status !== undefined) {
    const stageResult = await resolveStage(parsed.data.status, orgId);
    if (!stageResult.ok) {
      res.status(400).json({ error: stageResult.error });
      return;
    }
    // Moving to a closed stage requires close_tasks permission
    if (stageResult.stage.type === "closed" && !hasPermission(req, "close_tasks")) {
      res.status(403).json({ error: "You do not have permission to close tasks" });
      return;
    }
  }

  const [prev] = await db
    .select({
      status: tasksTable.status,
      priority: tasksTable.priority,
      assignee: tasksTable.assignee,
      category: tasksTable.category,
      title: tasksTable.title,
      dueDate: tasksTable.dueDate,
      projectId: tasksTable.projectId,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!prev) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (parsed.data.projectId != null) {
    const valid = await projectBelongsToOrg(parsed.data.projectId, orgId);
    if (!valid) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  if (parsed.data.assignee) {
    const validAssignee = await assigneeBelongsToOrg(parsed.data.assignee, orgId);
    if (!validAssignee) {
      res.status(400).json({ error: "Assignee must be a member of your organization" });
      return;
    }
  }

  let mergedCustomFields: Record<string, unknown> | undefined;
  // Hoisted so custom-field change events can be emitted after the update
  let prevCustomFields: Record<string, unknown> = {};
  let sanitizedIncomingCf: Record<string, unknown> = {};

  if (parsed.data.customFields !== undefined) {
    const result = await validateAndSanitizeCustomFields(
      parsed.data.customFields as Record<string, unknown>,
      orgId,
    );
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    sanitizedIncomingCf = result.sanitized ?? {};
    // Merge sanitized values with existing custom fields (partial update semantics)
    const [existing] = await db
      .select({ customFields: tasksTable.customFields })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
      .limit(1);
    prevCustomFields = (existing?.customFields as Record<string, unknown>) ?? {};
    mergedCustomFields = { ...prevCustomFields, ...sanitizedIncomingCf };
  }

  const { customFields: _rawCf, ...restUpdateData } = parsed.data;

  // Sanitize rich-text HTML before persistence (blocks stored XSS)
  if ("description" in restUpdateData) {
    (restUpdateData as Record<string, unknown>).description = sanitizeRichText(
      (restUpdateData as { description?: string | null }).description ?? null,
    );
  }

  const [task] = await db
    .update(tasksTable)
    .set({
      ...restUpdateData,
      ...(mergedCustomFields !== undefined
        ? { customFields: sql`${tasksTable.customFields}::jsonb || ${JSON.stringify(mergedCustomFields)}::jsonb` }
        : {}),
    })
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const next: TaskSnapshot = {
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    category: task.category,
    title: task.title,
    dueDate: task.dueDate,
    projectId: task.projectId,
  };

  const { actorId, actorName: actorNameStr } = resolveActor(req);
  const stagesMap = await getOrgStages(orgId);

  // Emit standard field change events (status, priority, assignee, etc.)
  await insertChangeEvents(params.data.id, orgId, actorId, actorNameStr, prev, next, stagesMap);

  // Emit one event per custom field that changed in this update.
  // Uses "cf:<fieldName>" to match the convention set in the force-cleanup path.
  if (Object.keys(sanitizedIncomingCf).length > 0) {
    // Determine which fields actually changed (serialize for stable comparison)
    const cfChanges: Array<{ fieldId: number; oldValue: string | null; newValue: string | null }> = [];
    for (const [rawId, newVal] of Object.entries(sanitizedIncomingCf)) {
      const oldVal = prevCustomFields[rawId] ?? null;
      const serialize = (v: unknown) =>
        v === null || v === undefined ? null : Array.isArray(v) ? JSON.stringify(v) : String(v);
      const oldStr = serialize(oldVal);
      const newStr = serialize(newVal);
      if (oldStr !== newStr) {
        cfChanges.push({ fieldId: Number(rawId), oldValue: oldStr, newValue: newStr });
      }
    }

    if (cfChanges.length > 0) {
      // Resolve field names for the "cf:<fieldName>" label
      const fieldIds = cfChanges.map((c) => c.fieldId);
      const defs = await db
        .select({ id: customFieldDefinitionsTable.id, name: customFieldDefinitionsTable.name })
        .from(customFieldDefinitionsTable)
        .where(and(eq(customFieldDefinitionsTable.orgId, orgId), inArray(customFieldDefinitionsTable.id, fieldIds)));
      const nameMap = new Map(defs.map((d) => [d.id, d.name]));

      await db.insert(taskEventsTable).values(
        cfChanges.map((c) => ({
          taskId: task.id,
          orgId,
          actorId,
          actorName: actorNameStr,
          field: `cf:${nameMap.get(c.fieldId) ?? c.fieldId}`,
          oldValue: c.oldValue,
          newValue: c.newValue,
        })),
      );
    }
  }

  const enriched = await buildTaskWithProject(task, orgId, stagesMap);
  const webhookCustomFields = await resolveCustomFieldNames(enriched.customFields as Record<string, unknown>, orgId);
  dispatchTaskUpdated(orgId, task.projectId, { ...enriched, customFields: webhookCustomFields });

  // Auto-watch the new assignee (fire-and-forget — errors are non-fatal)
  void (async () => {
    const assigneeChanged = "assignee" in parsed.data && parsed.data.assignee !== prev.assignee;
    if (assigneeChanged && task.assignee) {
      const assigneeUserId = await resolveAssigneeUserId(task.assignee, orgId);
      if (assigneeUserId) {
        await upsertWatcher(task.id, assigneeUserId, orgId);
      }
    }
  })();

  // Fire notifications (fire-and-forget)
  void (async () => {
    const assigneeChanged = "assignee" in parsed.data && parsed.data.assignee !== prev.assignee;
    const newAssigneeEmail = task.assignee;

    // Assignee notification — tell the new assignee they've been assigned
    if (assigneeChanged && newAssigneeEmail) {
      const assigneeUserId = await resolveAssigneeUserId(newAssigneeEmail, orgId);
      if (assigneeUserId) {
        await notifyTaskAssigned({
          taskId: task.id,
          taskTitle: task.title,
          orgId,
          actorId,
          actorName: actorNameStr,
          newAssigneeUserId: assigneeUserId,
        });
      }
    }

    // Status / priority / assignee change notifications — notify all watchers
    const statusChanged = parsed.data.status !== undefined && parsed.data.status !== prev.status;
    const priorityChanged = parsed.data.priority !== undefined && parsed.data.priority !== prev.priority;
    const assigneeFieldChanged = "assignee" in parsed.data && parsed.data.assignee !== prev.assignee;

    if (statusChanged || priorityChanged || assigneeFieldChanged) {
      const watcherIds = await getWatcherUserIds(task.id);
      // Deduplicate (assignee might also be a watcher)
      const uniqueWatcherIds = [...new Set(watcherIds)];

      if (statusChanged) {
        await notifyTaskUpdated({
          taskId: task.id,
          taskTitle: task.title,
          orgId,
          actorId,
          actorName: actorNameStr,
          recipientUserIds: uniqueWatcherIds,
          changedField: "status",
          newValue: task.status,
        });
      }
      if (priorityChanged) {
        await notifyTaskUpdated({
          taskId: task.id,
          taskTitle: task.title,
          orgId,
          actorId,
          actorName: actorNameStr,
          recipientUserIds: uniqueWatcherIds,
          changedField: "priority",
          newValue: task.priority,
        });
      }
      if (assigneeFieldChanged) {
        await notifyTaskUpdated({
          taskId: task.id,
          taskTitle: task.title,
          orgId,
          actorId,
          actorName: actorNameStr,
          recipientUserIds: uniqueWatcherIds,
          changedField: "assignee",
          newValue: task.assignee ?? "(unassigned)",
        });
      }
    }
  })();

  res.json(UpdateTaskResponse.parse(enriched));
});

router.delete("/tasks/bulk", requireOrgOrApiKey, requireScope("tasks:write"), async (req, res): Promise<void> => {
  const parsed = BulkDeleteTasksBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;

  if (!hasPermission(req, "delete_tasks")) {
    res.status(403).json({ error: "You do not have permission to delete tasks" });
    return;
  }

  const { ids } = parsed.data;
  if (ids.length === 0) {
    res.json(BulkDeleteTasksResponse.parse({ deleted: 0 }));
    return;
  }

  // Only delete tasks that belong to this org
  const existing = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(inArray(tasksTable.id, ids), eq(tasksTable.orgId, orgId)));

  if (existing.length === 0) {
    res.json(BulkDeleteTasksResponse.parse({ deleted: 0 }));
    return;
  }

  const ownedIds = existing.map((r) => r.id);
  await db.delete(commentsTable).where(inArray(commentsTable.taskId, ownedIds));
  await db.delete(tasksTable).where(and(inArray(tasksTable.id, ownedIds), eq(tasksTable.orgId, orgId)));

  res.json(BulkDeleteTasksResponse.parse({ deleted: ownedIds.length }));
});

router.delete("/tasks/:id", requireOrgOrApiKey, requireScope("tasks:write"), async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  if (!hasPermission(req, "delete_tasks")) {
    res.status(403).json({ error: "You do not have permission to delete tasks" });
    return;
  }

  // Verify the task belongs to this org BEFORE touching comments (cross-org safety)
  const [existing] = await db
    .select({
      id: tasksTable.id,
      orgTaskNumber: tasksTable.orgTaskNumber,
      title: tasksTable.title,
      projectId: tasksTable.projectId,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await db.delete(commentsTable).where(eq(commentsTable.taskId, existing.id));
  await db.delete(tasksTable).where(and(eq(tasksTable.id, existing.id), eq(tasksTable.orgId, orgId)));

  dispatchTaskDeleted(orgId, existing.projectId, {
    id: existing.id,
    orgTaskNumber: existing.orgTaskNumber,
    title: existing.title,
    orgId,
  });

  res.sendStatus(204);
});

router.get("/tasks/:id/events", requireOrgOrApiKey, requireScope("tasks:read"), async (req, res): Promise<void> => {
  const params = ListTaskEventsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  const [task] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const events = await db
    .select()
    .from(taskEventsTable)
    .where(and(eq(taskEventsTable.taskId, params.data.id), eq(taskEventsTable.orgId, orgId)))
    .orderBy(asc(taskEventsTable.createdAt));

  res.json(
    ListTaskEventsResponse.parse(
      events.map((e) => ({
        ...e,
        actorId: e.actorId ?? null,
        actorName: e.actorName ?? null,
        oldValue: e.oldValue ?? null,
        newValue: e.newValue ?? null,
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
      })),
    ),
  );
});

// ─── Watch / Unwatch / Watchers ──────────────────────────────────────────────

/**
 * GET /tasks/:id/watchers
 * Returns watcher count, whether the current user is watching, and up to 10
 * watcher avatars (enough for the task-detail header).
 */
router.get("/tasks/:id/watchers", requireOrgOrApiKey, requireScope("tasks:read"), async (req, res): Promise<void> => {
  const params = GetTaskWatchersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;

  // Confirm task belongs to this org
  const [task] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // Fetch watchers joined with user profiles
  const rows = await db
    .select({
      userId: taskWatchersTable.userId,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(taskWatchersTable)
    .innerJoin(usersTable, eq(taskWatchersTable.userId, usersTable.id))
    .where(eq(taskWatchersTable.taskId, params.data.id))
    .orderBy(taskWatchersTable.createdAt);

  const currentUserId = req.user?.id ?? null;
  const isWatching = currentUserId !== null && rows.some((r) => r.userId === currentUserId);

  res.json(
    GetTaskWatchersResponse.parse({
      count: rows.length,
      isWatching,
      watchers: rows.slice(0, 10),
    }),
  );
});

/**
 * POST /tasks/:id/watch — idempotent; safe to call even if already watching.
 */
router.post("/tasks/:id/watch", requireOrgOrApiKey, requireScope("tasks:write"), async (req, res): Promise<void> => {
  const params = WatchTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Confirm task belongs to this org
  const [task] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await upsertWatcher(task.id, userId, orgId);

  res.json(WatchTaskResponse.parse({ watching: true }));
});

/**
 * DELETE /tasks/:id/watch — idempotent; safe to call even if not watching.
 */
router.delete("/tasks/:id/watch", requireOrgOrApiKey, requireScope("tasks:write"), async (req, res): Promise<void> => {
  const params = UnwatchTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Confirm task belongs to this org (cross-org safety)
  const [task] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.orgId, orgId)))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await db
    .delete(taskWatchersTable)
    .where(
      and(
        eq(taskWatchersTable.taskId, task.id),
        eq(taskWatchersTable.userId, userId),
      ),
    );

  res.json(UnwatchTaskResponse.parse({ watching: false }));
});

export default router;
