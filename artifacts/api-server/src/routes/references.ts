/**
 * GET /references/search
 *
 * Searchable reference picker backend — returns tasks and projects for the
 * authenticated user's org so the MarkdownEditor # picker can offer inline
 * references.  Session-only (requireOrg); no API-key access.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, projectsTable } from "@workspace/db";
import { eq, and, ilike, inArray } from "drizzle-orm";
import { requireOrg } from "../middlewares/requireOrgMiddleware";
import { z } from "zod";

const ReferenceSearchQueryParams = z.object({
  q: z.string().max(200).default(""),
  type: z.enum(["task", "project", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const router = Router();

// GET /references/search?q=&type=all&limit=20
// Returns tasks and projects scoped to the caller's org.
// Protected by requireOrg — no API-key access.
router.get("/references/search", requireOrg, async (req, res) => {
  const parsed = ReferenceSearchQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { q, type, limit } = parsed.data;
  const orgId = req.orgId!;
  const pattern = q ? `%${q}%` : "%";

  const fetchTasks =
    type === "all" || type === "task"
      ? db
          .select({
            id: tasksTable.id,
            title: tasksTable.title,
            projectId: tasksTable.projectId,
          })
          .from(tasksTable)
          .where(and(eq(tasksTable.orgId, orgId), ilike(tasksTable.title, pattern)))
          .limit(limit)
      : Promise.resolve([]);

  const fetchProjects =
    type === "all" || type === "project"
      ? db
          .select({
            id: projectsTable.id,
            name: projectsTable.name,
          })
          .from(projectsTable)
          .where(
            and(eq(projectsTable.orgId, orgId), ilike(projectsTable.name, pattern)),
          )
          .limit(limit)
      : Promise.resolve([]);

  const [rawTasks, projects] = await Promise.all([fetchTasks, fetchProjects]);

  // Enrich tasks with project name when available
  const projectIds = [...new Set(rawTasks.map((t) => t.projectId).filter(Boolean))] as number[];
  let projectNameMap = new Map<number, string>();
  if (projectIds.length > 0) {
    // Fetch only the specific projects referenced by returned tasks, not the
    // entire org — this is called on every keystroke so the query must be tight.
    const projectRows = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.orgId, orgId),
          inArray(projectsTable.id, projectIds),
        ),
      );
    projectNameMap = new Map(projectRows.map((p) => [p.id, p.name]));
  }

  const tasks = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectName: t.projectId != null ? (projectNameMap.get(t.projectId) ?? null) : null,
  }));

  return res.json({ tasks, projects });
});

export default router;
