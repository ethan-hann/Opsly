import { pgTable, text, serial, timestamp, integer, varchar, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export type CustomFieldType = "text" | "number" | "date" | "single_select" | "multi_select";

export const customFieldDefinitionsTable = pgTable("custom_field_definitions", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").$type<CustomFieldType>().notNull(),
  /** Predefined options list for single_select / multi_select types. Null for other types. */
  options: jsonb("options").$type<string[]>(),
  position: integer("position").notNull().default(0),
  /** Soft-delete: non-null means the field is hidden from the UI but its data is preserved. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CustomFieldDefinition = typeof customFieldDefinitionsTable.$inferSelect;
