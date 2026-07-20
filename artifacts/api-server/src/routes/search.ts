import { Router } from "express";
import { db } from "@workspace/db";
import { notesTable, projectsTable, tasksTable } from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { requireOrg } from "../middlewares/requireOrgMiddleware";
import { z } from "zod";

const SearchQueryParams = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const router = Router();

// GET /search?q=&limit=5
// Runs parallel ILIKE queries on tasks.title, projects.name, and notes.title/content.
// All results are scoped to the caller's org.
//
// Performance: these ILIKE '%query%' patterns rely on GIN trigram indexes
// (pg_trgm) created by the migrate:add-search-trigram-indexes migration in
// lib/db.  If you add new searched columns or change the pattern style, run a
// matching migration to keep the indexes in sync.
//
// Note visibility: the notes query enforces a visibility gate so private notes
// only appear for their author.  Public notes (visibility = 'public_read') are
// visible to every org member.
router.get("/search", requireOrg, async (req, res) => {
  const parsed = SearchQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { q, limit } = parsed.data;
  const orgId = req.orgId!;
  // Empty string is a safe sentinel: no DB user_id is ever an empty string,
  // so it won't accidentally match any note's createdBy when there is no session user.
  const callerId = req.user?.id ?? "";
  const pattern = `%${q}%`;

  const [tasks, projects, notes] = await Promise.all([
    db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        priority: tasksTable.priority,
        projectId: tasksTable.projectId,
      })
      .from(tasksTable)
      .where(and(eq(tasksTable.orgId, orgId), ilike(tasksTable.title, pattern)))
      .limit(limit),
    db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        status: projectsTable.status,
      })
      .from(projectsTable)
      .where(
        and(eq(projectsTable.orgId, orgId), ilike(projectsTable.name, pattern))
      )
      .limit(limit),
    db
      .select({
        id: notesTable.id,
        title: notesTable.title,
        content: notesTable.content,
        // visibility and createdBy are fetched for the WHERE predicate only;
        // they are stripped from the response shape below.
        visibility: notesTable.visibility,
        createdBy: notesTable.createdBy,
      })
      .from(notesTable)
      .where(
        and(
          eq(notesTable.orgId, orgId),
          or(
            ilike(notesTable.title, pattern),
            ilike(notesTable.content, pattern)
          ),
          // Visibility gate: restrict notes to those the caller may read.
          // public_read  → visible to every org member.
          // private      → visible only to the note's author (createdBy).
          or(
            eq(notesTable.visibility, "public_read"),
            eq(notesTable.createdBy, callerId),
          )
        )
      )
      .limit(limit),
  ]);

  return res.json({
    tasks,
    projects,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      // Return a plain-text excerpt of the content (strip HTML tags) capped at 120 chars
      excerpt: n.content
        ? n.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
        : null,
    })),
  });
});

export default router;
