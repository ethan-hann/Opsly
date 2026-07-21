/**
 * Data export routes.
 *
 * POST /export        — trigger an export (streams directly for small orgs;
 *                       queues a background job for large orgs ≥ 10k rows)
 * GET  /export/pending — check whether the requesting user has a completed
 *                       background export ready to download
 * GET  /export/download/:token — download a completed background export
 */

import { Router } from "express";
import {
  db,
  tasksTable,
  projectsTable,
  commentsTable,
  notesTable,
  customFieldDefinitionsTable,
  exportJobsTable,
} from "@workspace/db";
import { eq, count, and, lt, or } from "drizzle-orm";
import { z } from "zod";
import { requireOrg, requirePermission } from "../middlewares/requireOrgMiddleware";
import { requireOrgFeature } from "../lib/org-features";

const requireDataExportFeature = requireOrgFeature('data_export');
import { createNotification } from "../lib/notifications";
import { logger } from "../lib/logger";
import { ZipArchive } from "archiver";
import crypto from "node:crypto";
import { getStorageProvider } from "../lib/storage/provider";

const router = Router();

// ── Request schema ────────────────────────────────────────────────────────────

const ExportBodySchema = z.object({
  scope: z
    .array(z.enum(["tasks", "projects", "notes", "comments"]))
    .min(1, "Select at least one entity type"),
  format: z.enum(["json", "csv"]),
});

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialise an array of objects to CSV.
 *
 * Headers are derived from the **union** of keys across *all* rows, not just
 * the first row. This ensures that sparse columns (e.g. custom fields that
 * only some tasks carry) are never silently dropped from the output.
 * Missing cells are emitted as empty strings.
 *
 * Exported for unit testing.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = [...headerSet];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ].join("\n");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

type ExportScope = ("tasks" | "projects" | "notes" | "comments")[];

interface ExportData {
  meta: { orgId: string; exportedAt: string; version: string };
  tasks?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  notes?: Record<string, unknown>[];
  comments?: Record<string, unknown>[];
}

async function fetchExportData(orgId: string, scope: ExportScope): Promise<ExportData> {
  const meta = { orgId, exportedAt: new Date().toISOString(), version: "1" };
  const result: ExportData = { meta };

  // Custom field definitions — needed to name columns in the tasks export.
  const fieldDefs = scope.includes("tasks")
    ? await db
        .select({ id: customFieldDefinitionsTable.id, name: customFieldDefinitionsTable.name })
        .from(customFieldDefinitionsTable)
        .where(eq(customFieldDefinitionsTable.orgId, orgId))
    : [];
  const fieldNameById = new Map(fieldDefs.map((f) => [String(f.id), f.name]));

  if (scope.includes("tasks")) {
    const rows = await db.select().from(tasksTable).where(eq(tasksTable.orgId, orgId));
    result.tasks = rows.map((t) => {
      const row: Record<string, unknown> = {
        id: t.id,
        orgTaskNumber: t.orgTaskNumber,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        priority: t.priority,
        category: t.category,
        assignee: t.assignee ?? null,
        dueDate: t.dueDate ?? null,
        projectId: t.projectId ?? null,
        slaBreachedAt: t.slaBreachedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
      // Flatten custom fields using definition names as column headers.
      if (t.customFields && typeof t.customFields === "object") {
        for (const [fieldId, value] of Object.entries(
          t.customFields as Record<string, unknown>,
        )) {
          const name = fieldNameById.get(fieldId) ?? `custom_${fieldId}`;
          row[`cf_${name}`] = Array.isArray(value) ? value.join("; ") : value;
        }
      }
      return row;
    });
  }

  if (scope.includes("projects")) {
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.orgId, orgId));
    result.projects = rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      status: p.status,
      priority: p.priority,
      dueDate: p.dueDate ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  if (scope.includes("notes")) {
    const rows = await db
      .select()
      .from(notesTable)
      .where(eq(notesTable.orgId, orgId));
    result.notes = rows.map((n) => ({
      id: n.id,
      title: n.title,
      // Rich-text content exported as plain text.
      content: stripHtml(n.content),
      visibility: n.visibility,
      projectId: n.projectId ?? null,
      taskId: n.taskId ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
  }

  if (scope.includes("comments")) {
    const rows = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.orgId, orgId));
    result.comments = rows.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      content: c.content,
      author: c.author ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  return result;
}

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeJson(data: ExportData): Buffer {
  return Buffer.from(JSON.stringify(data, null, 2), "utf-8");
}

function serializeCsv(data: ExportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const arc = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    arc.on("data", (chunk: Buffer) => chunks.push(chunk));
    arc.on("end", () => resolve(Buffer.concat(chunks)));
    arc.on("error", reject);

    if (data.tasks?.length) arc.append(toCsv(data.tasks), { name: "tasks.csv" });
    if (data.projects?.length) arc.append(toCsv(data.projects), { name: "projects.csv" });
    if (data.notes?.length) arc.append(toCsv(data.notes), { name: "notes.csv" });
    if (data.comments?.length) arc.append(toCsv(data.comments), { name: "comments.csv" });

    arc.finalize();
  });
}

// ── Row-count helper ──────────────────────────────────────────────────────────

async function countTotalRows(orgId: string, scope: ExportScope): Promise<number> {
  const counts = await Promise.all([
    scope.includes("tasks")
      ? db.select({ c: count() }).from(tasksTable).where(eq(tasksTable.orgId, orgId))
      : null,
    scope.includes("projects")
      ? db.select({ c: count() }).from(projectsTable).where(eq(projectsTable.orgId, orgId))
      : null,
    scope.includes("notes")
      ? db.select({ c: count() }).from(notesTable).where(eq(notesTable.orgId, orgId))
      : null,
    scope.includes("comments")
      ? db.select({ c: count() }).from(commentsTable).where(eq(commentsTable.orgId, orgId))
      : null,
  ]);
  return counts.reduce((sum, result) => sum + (result ? Number(result[0].c) : 0), 0);
}

// ── Scheduled cleanup ─────────────────────────────────────────────────────────

/**
 * Every 10 minutes:
 *  1. Expire rows past expiresAt → delete object from storage.
 *  2. Purge DB rows older than 24 hours.
 */
setInterval(async () => {
  try {
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Find rows that have passed their TTL but are not yet marked expired.
    const toExpire = await db
      .select({ id: exportJobsTable.id, objectKey: exportJobsTable.objectKey })
      .from(exportJobsTable)
      .where(
        and(
          lt(exportJobsTable.expiresAt, now),
          or(
            eq(exportJobsTable.status, "pending"),
            eq(exportJobsTable.status, "complete"),
          ),
        ),
      );

    if (toExpire.length > 0) {
      const storage = getStorageProvider();
      await Promise.all(
        toExpire.map(async (row) => {
          try {
            await storage.delete(row.objectKey);
          } catch (err) {
            logger.warn({ err, objectKey: row.objectKey }, "Failed to delete expired export object");
          }
          await db
            .update(exportJobsTable)
            .set({ status: "expired" })
            .where(eq(exportJobsTable.id, row.id));
        }),
      );
    }

    // 2. Purge rows older than 24 hours (any status).
    await db
      .delete(exportJobsTable)
      .where(lt(exportJobsTable.createdAt, cutoff24h));
  } catch (err) {
    logger.warn({ err }, "Export cleanup task failed");
  }
}, 10 * 60 * 1000).unref();

// ── POST /export ──────────────────────────────────────────────────────────────

router.post("/export", requireOrg, requireDataExportFeature, requirePermission("manage_org_settings"), async (req, res) => {
  const orgId = req.orgId!;

  const parsed = ExportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }

  const { scope, format } = parsed.data;
  const LARGE_ORG_THRESHOLD = 10_000;

  try {
    const totalRows = await countTotalRows(orgId, scope as ExportScope);

    const buildExport = async () => {
      const data = await fetchExportData(orgId, scope as ExportScope);
      const isJson = format === "json";
      const buffer = isJson ? serializeJson(data) : await serializeCsv(data);
      return {
        buffer,
        filename: isJson ? "export.json" : "export.zip",
        contentType: isJson ? "application/json" : "application/zip",
      };
    };

    if (totalRows < LARGE_ORG_THRESHOLD) {
      // Small org: stream the file directly.
      const { buffer, filename, contentType } = await buildExport();
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(buffer.length));
      res.send(buffer);
    } else {
      // Large org: acknowledge immediately, run in background.
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // If the user already has an active export row for this org, expire it
      // and delete its object before creating a new job.
      const existing = await db
        .select({ id: exportJobsTable.id, objectKey: exportJobsTable.objectKey, status: exportJobsTable.status })
        .from(exportJobsTable)
        .where(
          and(
            eq(exportJobsTable.userId, userId),
            eq(exportJobsTable.orgId, orgId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const old = existing[0];
        try {
          const storage = getStorageProvider();
          await storage.delete(old.objectKey);
        } catch (err) {
          logger.warn({ err, objectKey: old.objectKey }, "Failed to delete old export object");
        }
        // Delete the old row so the unique (userId, orgId) index allows the new INSERT.
        await db
          .delete(exportJobsTable)
          .where(eq(exportJobsTable.id, old.id));
      }

      // Create the new job row.
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      const objectKey = `${orgId}/${userId}/${token}`;
      const filename = format === "json" ? "export.json" : "export.zip";
      const contentType = format === "json" ? "application/json" : "application/zip";

      await db.insert(exportJobsTable).values({
        orgId,
        userId,
        token,
        objectKey,
        status: "pending",
        filename,
        contentType,
        expiresAt,
      });

      res.status(202).json({ status: "pending" });

      // Background job via setTimeout so the response flushes first.
      setTimeout(async () => {
        try {
          const { buffer } = await buildExport();
          const storage = getStorageProvider();
          await storage.put(objectKey, buffer, contentType);

          await db
            .update(exportJobsTable)
            .set({ status: "complete" })
            .where(eq(exportJobsTable.token, token));

          await createNotification({
            userId,
            orgId,
            type: "export_ready",
            actorId: null,
            actorName: null,
            entityType: "export",
            entityId: 0,
            message: `Your data export is ready to download. Visit Organization Settings to get it.`,
          });
        } catch (err) {
          logger.error({ err, orgId }, "Background export job failed");
        }
      }, 0);
    }
  } catch (err) {
    logger.error({ err, orgId }, "Export request failed");
    res.status(500).json({ error: "Export failed" });
  }
});

// ── GET /export/pending ───────────────────────────────────────────────────────

router.get("/export/pending", requireOrg, requireDataExportFeature, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orgId = req.orgId!;
  const now = new Date();

  const rows = await db
    .select()
    .from(exportJobsTable)
    .where(
      and(
        eq(exportJobsTable.userId, userId),
        eq(exportJobsTable.orgId, orgId),
        eq(exportJobsTable.status, "complete"),
      ),
    )
    .limit(1);

  const job = rows[0];

  if (!job || job.expiresAt < now) {
    res.json({ pending: false });
    return;
  }

  res.json({
    pending: true,
    token: job.token,
    filename: job.filename,
    expiresAt: job.expiresAt.toISOString(),
  });
});

// ── GET /export/download/:token ───────────────────────────────────────────────

router.get("/export/download/:token", requireOrg, requireDataExportFeature, requirePermission("manage_org_settings"), async (req, res) => {
  const token = String(req.params["token"] ?? "");
  if (!token) {
    res.status(404).json({ error: "Export expired — start a new one" });
    return;
  }

  const now = new Date();

  const rows = await db
    .select()
    .from(exportJobsTable)
    .where(
      and(
        eq(exportJobsTable.token, token),
        eq(exportJobsTable.orgId, req.orgId!),
      ),
    )
    .limit(1);

  const job = rows[0];

  if (!job || job.status !== "complete" || job.expiresAt < now) {
    res.status(404).json({ error: "Export expired — start a new one" });
    return;
  }

  try {
    const storage = getStorageProvider();
    const buffer = await storage.get(job.objectKey);

    if (!buffer) {
      res.status(404).json({ error: "Export expired — start a new one" });
      return;
    }

    res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
    res.setHeader("Content-Type", job.contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  } catch (err) {
    logger.error({ err, token }, "Failed to stream export download");
    res.status(500).json({ error: "Download failed" });
  }
});

export default router;
