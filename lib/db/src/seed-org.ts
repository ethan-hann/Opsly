/**
 * Seed script: create a default "Development Org" and assign all existing
 * projects, tasks, and notes that have no orgId to it.
 *
 * Run with: pnpm --filter @workspace/db run seed
 */
import { db, organizationsTable, orgMembersTable, projectsTable, tasksTable, notesTable } from "./index";
import { isNull, eq } from "drizzle-orm";

async function seed() {
  console.log("Checking for unassigned data...");

  const unassignedProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(isNull(projectsTable.orgId));

  const unassignedTasks = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(isNull(tasksTable.orgId));

  const unassignedNotes = await db
    .select({ id: notesTable.id })
    .from(notesTable)
    .where(isNull(notesTable.orgId));

  if (
    unassignedProjects.length === 0 &&
    unassignedTasks.length === 0 &&
    unassignedNotes.length === 0
  ) {
    console.log("No unassigned data found. Nothing to seed.");
    process.exit(0);
  }

  console.log(
    `Found ${unassignedProjects.length} projects, ${unassignedTasks.length} tasks, ${unassignedNotes.length} notes without an org.`,
  );

  // Create default org
  const [org] = await db
    .insert(organizationsTable)
    .values({ name: "Default Organization" })
    .returning();

  console.log(`Created default org: ${org.id} (${org.name})`);

  // Assign all unassigned data
  if (unassignedProjects.length > 0) {
    await db
      .update(projectsTable)
      .set({ orgId: org.id })
      .where(isNull(projectsTable.orgId));
    console.log(`Assigned ${unassignedProjects.length} projects to org.`);
  }

  if (unassignedTasks.length > 0) {
    await db
      .update(tasksTable)
      .set({ orgId: org.id })
      .where(isNull(tasksTable.orgId));
    console.log(`Assigned ${unassignedTasks.length} tasks to org.`);
  }

  if (unassignedNotes.length > 0) {
    await db
      .update(notesTable)
      .set({ orgId: org.id })
      .where(isNull(notesTable.orgId));
    console.log(`Assigned ${unassignedNotes.length} notes to org.`);
  }

  console.log("Seed complete! The first user who logs in can create an org or will be auto-added.");
  console.log(`Default org ID: ${org.id}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
