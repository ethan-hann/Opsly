import { pgTable, text, serial, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tasksTable } from "./tasks";
import { organizationsTable } from "./organizations";

/**
 * Comments on tasks.
 *
 * Migration note for org_id
 * -------------------------
 * org_id is intentionally nullable to support a safe three-phase rollout:
 *
 *   Phase 1 (this commit) — column added as NULLABLE with FK reference.
 *                           Existing rows have org_id = NULL.
 *
 *   Phase 2 (backfill)    — Run the backfill script:
 *                           `pnpm --filter @workspace/db migrate:backfill-comments-org-id`
 *                           This populates org_id from the parent task for all NULL rows.
 *
 *   Phase 3 (enforce)     — Once the backfill is verified complete, a follow-up schema
 *                           change adds `.notNull()` here and runs `pnpm --filter @workspace/db push`.
 *
 * Route-level isolation code in `artifacts/api-server/src/routes/comments.ts`
 * handles the NULL case gracefully by falling back to task-join scoping for any
 * rows still pending backfill.
 */
export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  author: text("author"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommentSchema = createInsertSchema(commentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;
