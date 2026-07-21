import { pgTable, text, serial, timestamp, integer, varchar, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tasksTable } from "./tasks";
import { organizationsTable } from "./organizations";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").references((): any => commentsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  author: text("author"),
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
});

export const insertCommentSchema = createInsertSchema(commentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentsTable.$inferSelect;

// ─── Comment reactions ────────────────────────────────────────────────────────

export const commentReactionsTable = pgTable(
  "comment_reactions",
  {
    id: serial("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    commentId: integer("comment_id")
      .notNull()
      .references(() => commentsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    emoji: varchar("emoji", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("comment_reactions_unique").on(table.commentId, table.userId, table.emoji),
  ],
);

export type CommentReaction = typeof commentReactionsTable.$inferSelect;
