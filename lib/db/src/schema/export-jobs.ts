/**
 * exportJobsTable — persists background export job state.
 *
 * Replaces the in-memory Maps that were previously used to track pending
 * background exports, so that a server restart between job completion and the
 * admin clicking "Download" no longer silently destroys the file.
 *
 * Lifecycle:
 *  1. Row inserted with status="pending" when a large-org export is queued.
 *  2. Status updated to "complete" when the worker finishes writing to storage.
 *  3. A scheduled task expires rows past expiresAt (→ status="expired"),
 *     deletes their objects from storage, and purges rows older than 24 hours.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { usersTable } from "./auth";

export const exportJobStatusEnum = pgEnum("export_job_status", [
  "pending",
  "complete",
  "expired",
]);

export type ExportJobStatus = (typeof exportJobStatusEnum.enumValues)[number];

export const exportJobsTable = pgTable(
  "export_jobs",
  {
    /** Stable primary key — never exposed to users, used for internal joins. */
    id: uuid("id").primaryKey().defaultRandom(),

    orgId: varchar("org_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),

    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /**
     * Opaque download token handed to the frontend.
     * Unique so the download route can do a direct lookup without knowing orgId.
     */
    token: varchar("token", { length: 64 }).notNull(),

    /** Storage key (path within the bucket / object store). */
    objectKey: text("object_key").notNull(),

    status: exportJobStatusEnum("status").notNull().default("pending"),

    /** Original filename shown in the Content-Disposition header. */
    filename: varchar("filename", { length: 255 }).notNull(),

    /** MIME type of the stored file. */
    contentType: varchar("content_type", { length: 128 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** When the file expires and the storage object should be deleted. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("export_jobs_token_idx").on(table.token),
    // Fast lookup: "does this user have a pending/complete export in this org?"
    uniqueIndex("export_jobs_user_org_active_idx").on(table.userId, table.orgId),
  ],
);

export type ExportJob = typeof exportJobsTable.$inferSelect;
export type InsertExportJob = typeof exportJobsTable.$inferInsert;
