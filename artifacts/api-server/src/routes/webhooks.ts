/**
 * Webhook routes — inbound (ingest + CRUD) and outbound (CRUD).
 *
 * Public route:
 *   POST /webhooks/inbound/:token/ingest  — no session auth required; the token
 *        in the URL acts as a bearer credential (64-char random hex).  External
 *        systems (Datadog, PagerDuty, GitHub Actions, curl, …) POST any JSON
 *        object and we create a task from it.
 *
 * Authenticated routes (requireOrg):
 *   GET|POST        /webhooks/inbound
 *   GET|PATCH|DELETE /webhooks/inbound/:id
 *   POST            /webhooks/inbound/:id/rotate-secret
 *   GET|POST        /webhooks/outbound
 *   GET|PATCH|DELETE /webhooks/outbound/:id
 */

import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod/v4";
import { eq, and, or, ne, desc, inArray, isNull, asc } from "drizzle-orm";
import {
  db,
  inboundWebhooksTable,
  outboundWebhooksTable,
  outboundWebhookDeliveriesTable,
  tasksTable,
  projectsTable,
  customFieldDefinitionsTable,
  workflowStagesTable,
} from "@workspace/db";
import type { WebhookTaskTemplate, OutboundWebhookEvent } from "@workspace/db";
import { requireOrg } from "../middlewares/requireOrgMiddleware";
import { dispatchTaskCreated } from "../lib/webhook-dispatcher";
import { sql } from "drizzle-orm";

const router = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars
}


/** Resolve a dot-notation path within an object. */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** Visibility filter: own webhooks + any non-private shared webhook. */
function inboundVisibilityFilter(userId: string) {
  return or(
    eq(inboundWebhooksTable.createdBy, userId),
    ne(inboundWebhooksTable.visibility, "private"),
  );
}

function outboundVisibilityFilter(userId: string) {
  return or(
    eq(outboundWebhooksTable.createdBy, userId),
    ne(outboundWebhooksTable.visibility, "private"),
  );
}

function serializeInbound(w: typeof inboundWebhooksTable.$inferSelect, userId: string) {
  return {
    ...w,
    isOwner: w.createdBy === userId,
    ingestUrl: buildIngestUrl(w.token),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function serializeOutbound(w: typeof outboundWebhooksTable.$inferSelect, userId: string) {
  return {
    ...w,
    isOwner: w.createdBy === userId,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function buildIngestUrl(token: string): string {
  // The base API path is /api — callers reconstruct the full URL from the token.
  // We return the path only; the frontend prepends the origin.
  return `/api/webhooks/inbound/${token}/ingest`;
}

/**
 * Normalize any date-like value to a YYYY-MM-DD string.
 *
 * Accepted inputs
 * ───────────────
 * • number   — Unix timestamp in seconds (< 1e10) or milliseconds (>= 1e10).
 *              Datadog, PagerDuty, and many monitoring tools send seconds.
 * • string   — YYYY-MM-DD (returned as-is)
 *              ISO 8601 with time/TZ  e.g. "2025-03-15T10:30:00Z"
 *              YYYY/MM/DD  e.g. "2025/03/15"
 *              MM/DD/YYYY  e.g. "03/15/2025"  (US format, common in Jira exports)
 *              Named months e.g. "March 15, 2025" (handled by native Date parser)
 *
 * All output is UTC-anchored so a timestamp like "2025-03-15T23:00:00-05:00"
 * produces "2025-03-16" rather than "2025-03-15" (correct calendar day in UTC).
 *
 * Returns undefined for any value that cannot be parsed as a valid date.
 */
function normalizeDate(val: unknown): string | undefined {
  if (val === null || val === undefined || val === "") return undefined;

  let ms: number | undefined;

  if (typeof val === "number") {
    // Heuristic: seconds if the value is plausibly a recent/near-future Unix
    // second-timestamp (year ~1970-2286), milliseconds otherwise.
    ms = val < 1e10 ? val * 1000 : val;
  } else if (typeof val === "string") {
    const s = val.trim();
    if (!s) return undefined;

    // Fast path: already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // YYYY/MM/DD
    const isoSlash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (isoSlash) {
      ms = Date.UTC(Number(isoSlash[1]), Number(isoSlash[2]) - 1, Number(isoSlash[3]));
    } else {
      // MM/DD/YYYY  (US format)
      const usSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (usSlash) {
        ms = Date.UTC(Number(usSlash[3]), Number(usSlash[1]) - 1, Number(usSlash[2]));
      } else {
        // ISO 8601 with time, named months, etc. — let the native parser handle it
        const d = new Date(s);
        if (!isNaN(d.getTime())) ms = d.getTime();
      }
    }
  }

  if (ms === undefined || isNaN(ms)) return undefined;

  const d = new Date(ms);
  if (isNaN(d.getTime())) return undefined;

  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

/** Minimal CF definition shape needed by applyTemplate. */
type CfDef = { id: number; type: string };

/** Apply the webhook's task template to a raw ingest payload. */
function applyTemplate(
  payload: Record<string, unknown>,
  template: WebhookTaskTemplate,
  projectId: number | null,
  /** Optional custom-field definitions — used to normalize date-type CF values. */
  cfDefs?: CfDef[],
): {
  title: string;
  description: string | undefined;
  priority: string;
  category: string;
  dueDate: string | undefined;
  assignee: string | undefined;
  status: string | undefined;
  projectId: number | null;
  /** Custom field values keyed by definition ID (string). Populated when
   *  fieldMapping entries target "cf:<id>" (e.g. "cf:3"). */
  customFields: Record<string, unknown>;
} {
  // Resolution order for every field:
  //   template defaults  →  direct payload keys  →  fieldMapping (most specific)

  // Title
  const titleFromField = template.titleField ? getPath(payload, template.titleField) : undefined;
  let title =
    String(titleFromField ?? payload["title"] ?? template.defaultTitle ?? "Untitled Alert").slice(0, 500);

  // Description
  const descFromField = template.descriptionField ? getPath(payload, template.descriptionField) : undefined;
  const rawDesc = descFromField ?? payload["description"];
  let description: string | undefined = rawDesc ? String(rawDesc) : undefined;

  // Priority + category — template defaults, then direct payload keys
  let priority: string = template.defaultPriority ?? "medium";
  let category: string = template.defaultCategory ?? "incident";
  if (payload["priority"]) priority = String(payload["priority"]);
  if (payload["category"]) category = String(payload["category"]);

  // Assignee + status — direct payload keys (no template defaults)
  let assignee: string | undefined =
    payload["assignee"] != null ? String(payload["assignee"]) : undefined;
  let status: string | undefined =
    payload["status"] != null ? String(payload["status"]) : undefined;

  // dueDate — direct payload key (normalized)
  let dueDate: string | undefined = normalizeDate(payload["dueDate"]);

  // fieldMapping overrides everything (most specific).
  // Supported targets: title · description · priority · category · dueDate ·
  //                    assignee · status · cf:<id>
  const customFields: Record<string, unknown> = {};
  if (template.fieldMapping) {
    for (const [payloadPath, taskField] of Object.entries(template.fieldMapping)) {
      const val = getPath(payload, payloadPath);
      if (val === undefined || val === null) continue;
      if (taskField === "title") title = String(val).slice(0, 500);
      else if (taskField === "description") description = String(val);
      else if (taskField === "priority") priority = String(val);
      else if (taskField === "category") category = String(val);
      else if (taskField === "assignee") assignee = String(val);
      else if (taskField === "status") status = String(val);
      else if (taskField === "dueDate") {
        const nd = normalizeDate(val);
        if (nd) dueDate = nd;
      } else if (taskField.startsWith("cf:")) {
        const cfId = taskField.slice(3);
        if (cfId) {
          const def = cfDefs?.find((f) => String(f.id) === cfId);
          // Normalize date-type custom fields; pass all other types through as-is.
          customFields[cfId] = def?.type === "date" ? (normalizeDate(val) ?? val) : val;
        }
      }
    }
  }

  // Validate enums — fall back to defaults on invalid values
  const validPriorities = ["low", "medium", "high", "critical"];
  const validCategories = ["incident", "change", "maintenance", "deployment", "support", "other"];
  if (!validPriorities.includes(priority)) priority = "medium";
  if (!validCategories.includes(category)) category = "incident";
  // status is passed through as-is here; the ingest handler validates it against
  // the org's active workflow stages and falls back to the default open stage if
  // the value is absent, non-numeric, archived, or belongs to a different org.

  return { title, description, priority, category, dueDate, assignee, status, projectId, customFields };
}

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

const ALL_EVENTS: OutboundWebhookEvent[] = [
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.commented",
  "task.sla_breached",
  "task.sla_warning",
  "project.created",
  "project.updated",
  "note.created",
  "note.updated",
  "note.deleted",
];

const WebhookVisibilityEnum = z.enum(["private", "public_read", "public_write"]);
const OutboundEventEnum = z.enum([
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.commented",
  "task.sla_breached",
  "task.sla_warning",
  "project.created",
  "project.updated",
  "note.created",
  "note.updated",
  "note.deleted",
]);

const WebhookTaskTemplateSchema = z
  .object({
    titleField: z.string().optional(),
    defaultTitle: z.string().optional(),
    descriptionField: z.string().optional(),
    defaultPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
    defaultCategory: z
      .enum(["incident", "change", "maintenance", "deployment", "support", "other"])
      .optional(),
    fieldMapping: z.record(z.string(), z.string()).optional(),
  })
  .optional()
  .default({});

const CreateInboundSchema = z.object({
  name: z.string().min(1).max(200),
  projectId: z.number().int().positive().optional().nullable(),
  visibility: WebhookVisibilityEnum.optional().default("private"),
  enabled: z.boolean().optional().default(true),
  taskTemplate: WebhookTaskTemplateSchema,
  /** Max tasks per 60-second rolling window. Default 60. */
  rateLimitPerMinute: z.number().int().min(1).max(10_000).optional().default(60),
});

const UpdateInboundSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  projectId: z.number().int().positive().optional().nullable(),
  visibility: WebhookVisibilityEnum.optional(),
  enabled: z.boolean().optional(),
  taskTemplate: WebhookTaskTemplateSchema,
  rateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
});

const CreateOutboundSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.url(),
  projectId: z.number().int().positive().optional().nullable(),
  events: z.array(OutboundEventEnum).min(1),
  visibility: WebhookVisibilityEnum.optional().default("private"),
  enabled: z.boolean().optional().default(true),
});

const UpdateOutboundSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.url().optional(),
  projectId: z.number().int().positive().optional().nullable(),
  events: z.array(OutboundEventEnum).min(1).optional(),
  visibility: WebhookVisibilityEnum.optional(),
  enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// PUBLIC: Ingest endpoint
// ---------------------------------------------------------------------------

router.post("/webhooks/inbound/:token/ingest", async (req, res): Promise<void> => {
  const { token } = req.params;

  // Look up webhook by token
  const [hook] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(eq(inboundWebhooksTable.token, token))
    .limit(1);

  if (!hook) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }

  if (!hook.enabled) {
    res.status(403).json({ error: "Webhook is disabled" });
    return;
  }

  // Rate-limit: count tasks created by this hook in the last 60 seconds.
  // We use a raw sql fragment so this works against the real DB and the
  // unit-test mock equally (both handle sql`` via the selectQueue).
  const [{ recentCount }] = await db
    .select({ recentCount: sql<number>`COUNT(*)::int` })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.sourceWebhookId, hook.id),
        sql`${tasksTable.createdAt} > NOW() - INTERVAL '1 minute'`,
      ),
    );

  const limit = hook.rateLimitPerMinute;
  const remaining = Math.max(0, limit - recentCount);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Window", "60s");

  if (recentCount >= limit) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({
      error: `Rate limit exceeded. This webhook may create at most ${limit} tasks per minute.`,
    });
    return;
  }

  // Payload must be an object
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Payload must be a JSON object" });
    return;
  }

  const payload = req.body as Record<string, unknown>;
  const template = (hook.taskTemplate ?? {}) as WebhookTaskTemplate;

  // Load CF definitions so applyTemplate can normalize date-type custom fields.
  const cfDefs = await db
    .select({ id: customFieldDefinitionsTable.id, type: customFieldDefinitionsTable.type })
    .from(customFieldDefinitionsTable)
    .where(eq(customFieldDefinitionsTable.orgId, hook.orgId));

  const taskFields = applyTemplate(payload, template, hook.projectId ?? null, cfDefs);

  // Validate project still belongs to org (guard against project deletion race)
  if (taskFields.projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.id, taskFields.projectId),
          eq(projectsTable.orgId, hook.orgId),
        ),
      )
      .limit(1);
    if (!proj) taskFields.projectId = null;
  }

  // Compute next org task number
  const [{ nextNum }] = await db
    .select({ nextNum: sql<number>`COALESCE(MAX(${tasksTable.orgTaskNumber}), 0) + 1` })
    .from(tasksTable)
    .where(eq(tasksTable.orgId, hook.orgId));

  // Resolve status: validate any provided value against the org's active stages,
  // then fall back to the first open stage when absent or invalid.
  let taskStatus: string | undefined;
  const providedStatus = taskFields.status;
  if (providedStatus) {
    const stageId = parseInt(providedStatus, 10);
    if (!isNaN(stageId)) {
      const [validStage] = await db
        .select({ id: workflowStagesTable.id })
        .from(workflowStagesTable)
        .where(
          and(
            eq(workflowStagesTable.id, stageId),
            eq(workflowStagesTable.orgId, hook.orgId),
            isNull(workflowStagesTable.archivedAt),
          ),
        )
        .limit(1);
      if (validStage) taskStatus = String(validStage.id);
    }
  }
  if (!taskStatus) {
    const [defaultStage] = await db
      .select({ id: workflowStagesTable.id })
      .from(workflowStagesTable)
      .where(
        and(
          eq(workflowStagesTable.orgId, hook.orgId),
          eq(workflowStagesTable.type, "open"),
          isNull(workflowStagesTable.archivedAt),
        ),
      )
      .orderBy(asc(workflowStagesTable.position))
      .limit(1);
    taskStatus = defaultStage ? String(defaultStage.id) : undefined;
  }

  const [task] = await db
    .insert(tasksTable)
    .values({
      orgId: hook.orgId,
      projectId: taskFields.projectId,
      orgTaskNumber: nextNum,
      sourceWebhookId: hook.id,
      title: taskFields.title,
      description: taskFields.description,
      priority: taskFields.priority,
      category: taskFields.category,
      dueDate: taskFields.dueDate,
      status: taskStatus,
      assignee: taskFields.assignee,
      ...(Object.keys(taskFields.customFields).length > 0
        ? { customFields: taskFields.customFields }
        : {}),
    })
    .returning();

  // Fire outbound webhooks async
  dispatchTaskCreated(hook.orgId, task.projectId, {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  });

  res.status(201).json({
    taskId: task.id,
    orgTaskNumber: task.orgTaskNumber,
    title: task.title,
  });
});

// ---------------------------------------------------------------------------
// AUTHENTICATED: Inbound webhook CRUD
// ---------------------------------------------------------------------------

// GET /webhooks/inbound — list
router.get("/webhooks/inbound", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const userId = req.user!.id;

  const hooks = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.orgId, orgId), inboundVisibilityFilter(userId)))
    .orderBy(inboundWebhooksTable.createdAt);

  res.json(hooks.map((h) => serializeInbound(h, userId)));
});

// POST /webhooks/inbound — create
router.post("/webhooks/inbound", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;
  const { name, projectId, visibility, enabled, taskTemplate } = parsed.data;

  // Validate projectId belongs to org
  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
  }

  const [hook] = await db
    .insert(inboundWebhooksTable)
    .values({
      orgId,
      createdBy: userId,
      name,
      token: generateToken(),
      projectId: projectId ?? null,
      visibility,
      enabled,
      taskTemplate: taskTemplate ?? {},
    })
    .returning();

  res.status(201).json(serializeInbound(hook, userId));
});

// GET /webhooks/inbound/activity — per-hook task creation counts for loop detection
// Must be registered before /:id so "activity" isn't matched as an id.
router.get("/webhooks/inbound/activity", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const userId = req.user!.id;

  const hooks = await db
    .select({ id: inboundWebhooksTable.id })
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.orgId, orgId), inboundVisibilityFilter(userId)));

  if (hooks.length === 0) { res.json({}); return; }

  const hookIds = hooks.map((h) => h.id);

  // Single query: count per hook for tasks in the last hour,
  // with a per-minute sub-count via conditional aggregation.
  const counts = await db
    .select({
      sourceWebhookId: tasksTable.sourceWebhookId,
      tasksLastMinute: sql<number>`COUNT(*) FILTER (WHERE ${tasksTable.createdAt} > NOW() - INTERVAL '1 minute')::int`,
      tasksLastHour: sql<number>`COUNT(*)::int`,
    })
    .from(tasksTable)
    .where(
      and(
        inArray(tasksTable.sourceWebhookId, hookIds),
        sql`${tasksTable.createdAt} > NOW() - INTERVAL '1 hour'`,
      ),
    )
    .groupBy(tasksTable.sourceWebhookId);

  const activity: Record<number, { tasksLastMinute: number; tasksLastHour: number }> = {};
  for (const h of hooks) activity[h.id] = { tasksLastMinute: 0, tasksLastHour: 0 };
  for (const row of counts) {
    if (row.sourceWebhookId != null) {
      activity[row.sourceWebhookId] = {
        tasksLastMinute: row.tasksLastMinute,
        tasksLastHour: row.tasksLastHour,
      };
    }
  }

  res.json(activity);
});

// GET /webhooks/inbound/:id — get
router.get("/webhooks/inbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [hook] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(
      and(
        eq(inboundWebhooksTable.id, id),
        eq(inboundWebhooksTable.orgId, orgId),
        inboundVisibilityFilter(userId),
      ),
    )
    .limit(1);

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json(serializeInbound(hook, userId));
});

// PATCH /webhooks/inbound/:id — update (creator only)
router.patch("/webhooks/inbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can update this webhook" });
    return;
  }

  const { projectId, ...rest } = parsed.data;

  // Validate projectId if changing
  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) { res.status(400).json({ error: "Invalid projectId" }); return; }
  }

  const updateData: Partial<typeof inboundWebhooksTable.$inferInsert> = { ...rest };
  if (projectId !== undefined) updateData.projectId = projectId;

  const [hook] = await db
    .update(inboundWebhooksTable)
    .set(updateData)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .returning();

  res.json(serializeInbound(hook, userId));
});

// DELETE /webhooks/inbound/:id — delete (creator only)
router.delete("/webhooks/inbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can delete this webhook" });
    return;
  }

  await db
    .delete(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)));

  res.sendStatus(204);
});

// POST /webhooks/inbound/:id/rotate-secret — rotate token (creator only)
router.post("/webhooks/inbound/:id/rotate-secret", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(inboundWebhooksTable)
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can rotate this secret" });
    return;
  }

  const [hook] = await db
    .update(inboundWebhooksTable)
    .set({ token: generateToken() })
    .where(and(eq(inboundWebhooksTable.id, id), eq(inboundWebhooksTable.orgId, orgId)))
    .returning();

  res.json(serializeInbound(hook, userId));
});

// ---------------------------------------------------------------------------
// AUTHENTICATED: Outbound webhook CRUD
// ---------------------------------------------------------------------------

// GET /webhooks/outbound — list
router.get("/webhooks/outbound", requireOrg, async (req, res): Promise<void> => {
  const orgId = req.orgId!;
  const userId = req.user!.id;

  const hooks = await db
    .select()
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.orgId, orgId), outboundVisibilityFilter(userId)))
    .orderBy(outboundWebhooksTable.createdAt);

  res.json(hooks.map((h) => serializeOutbound(h, userId)));
});

// POST /webhooks/outbound — create
router.post("/webhooks/outbound", requireOrg, async (req, res): Promise<void> => {
  const parsed = CreateOutboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;
  const { name, url, projectId, events, visibility, enabled } = parsed.data;

  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) { res.status(400).json({ error: "Invalid projectId" }); return; }
  }

  const [hook] = await db
    .insert(outboundWebhooksTable)
    .values({
      orgId,
      createdBy: userId,
      name,
      url,
      secret: generateToken(),
      projectId: projectId ?? null,
      events,
      visibility,
      enabled,
    })
    .returning();

  res.status(201).json(serializeOutbound(hook, userId));
});

// GET /webhooks/outbound/:id/deliveries — list recent deliveries
router.get("/webhooks/outbound/:id/deliveries", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  // Verify the webhook belongs to this org and is visible to the caller
  const [hook] = await db
    .select({ id: outboundWebhooksTable.id })
    .from(outboundWebhooksTable)
    .where(
      and(
        eq(outboundWebhooksTable.id, id),
        eq(outboundWebhooksTable.orgId, orgId),
        outboundVisibilityFilter(userId),
      ),
    )
    .limit(1);

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }

  const deliveries = await db
    .select()
    .from(outboundWebhookDeliveriesTable)
    .where(eq(outboundWebhookDeliveriesTable.webhookId, id))
    .orderBy(desc(outboundWebhookDeliveriesTable.createdAt))
    .limit(25);

  res.json(deliveries);
});

// GET /webhooks/outbound/:id — get
router.get("/webhooks/outbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [hook] = await db
    .select()
    .from(outboundWebhooksTable)
    .where(
      and(
        eq(outboundWebhooksTable.id, id),
        eq(outboundWebhooksTable.orgId, orgId),
        outboundVisibilityFilter(userId),
      ),
    )
    .limit(1);

  if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json(serializeOutbound(hook, userId));
});

// PATCH /webhooks/outbound/:id — update (creator only)
router.patch("/webhooks/outbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateOutboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can update this webhook" });
    return;
  }

  const { projectId, ...rest } = parsed.data;

  if (projectId != null) {
    const [proj] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.orgId, orgId)))
      .limit(1);
    if (!proj) { res.status(400).json({ error: "Invalid projectId" }); return; }
  }

  const updateData: Partial<typeof outboundWebhooksTable.$inferInsert> = { ...rest };
  if (projectId !== undefined) updateData.projectId = projectId;

  const [hook] = await db
    .update(outboundWebhooksTable)
    .set(updateData)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)))
    .returning();

  res.json(serializeOutbound(hook, userId));
});

// DELETE /webhooks/outbound/:id — delete (creator only)
router.delete("/webhooks/outbound/:id", requireOrg, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const orgId = req.orgId!;
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Webhook not found" }); return; }
  if (existing.createdBy !== userId) {
    res.status(403).json({ error: "Only the creator can delete this webhook" });
    return;
  }

  await db
    .delete(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.id, id), eq(outboundWebhooksTable.orgId, orgId)));

  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Test endpoints — no DB writes; connectivity/template checks only
// ---------------------------------------------------------------------------

const TestOutboundSchema = z.object({ url: z.url() });

// POST /webhooks/outbound/test — fire a signed test event to any URL
router.post("/webhooks/outbound/test", requireOrg, async (req, res): Promise<void> => {
  const parsed = TestOutboundSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const testSecret = generateToken();
  const body = JSON.stringify({
    event: "test",
    timestamp: new Date().toISOString(),
    data: { message: "Test delivery from Opsly. If you received this, your endpoint is reachable." },
  });
  const sig = "sha256=" + crypto.createHmac("sha256", testSecret).update(body).digest("hex");

  const start = Date.now();
  try {
    const response = await fetch(parsed.data.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Opsly-Webhook/1.0",
        "X-Opsly-Signature": sig,
        "X-Opsly-Event": "test",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    res.json({ success: response.ok, statusCode: response.status, durationMs: Date.now() - start });
  } catch (err) {
    res.json({
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

const TestInboundSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  template: WebhookTaskTemplateSchema,
});

// POST /webhooks/inbound/test — dry-run a payload through applyTemplate
router.post("/webhooks/inbound/test", requireOrg, async (req, res): Promise<void> => {
  const parsed = TestInboundSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const orgId = req.orgId!;
  const cfDefs = await db
    .select({ id: customFieldDefinitionsTable.id, type: customFieldDefinitionsTable.type })
    .from(customFieldDefinitionsTable)
    .where(eq(customFieldDefinitionsTable.orgId, orgId));

  const result = applyTemplate(
    parsed.data.payload as Record<string, unknown>,
    parsed.data.template as WebhookTaskTemplate,
    null,
    cfDefs,
  );
  res.json(result);
});

export default router;
