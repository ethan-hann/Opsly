import { pgTable, serial, integer, varchar, unique } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { tasksTable } from "./tasks";

export const taskDependenciesTable = pgTable(
  "task_dependencies",
  {
    id: serial("id").primaryKey(),
    orgId: varchar("org_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  },
  (table) => [unique("task_dependencies_task_depends_on_uniq").on(table.taskId, table.dependsOnTaskId)],
);

export type TaskDependency = typeof taskDependenciesTable.$inferSelect;
export type InsertTaskDependency = typeof taskDependenciesTable.$inferInsert;
