/**
 * Index-coverage test for task_events(task_id, org_id).
 *
 * Verifies that the composite B-tree index added by
 * add-task-events-index.ts is:
 *
 *   1. Present in pg_indexes (structural check).
 *   2. Actually chosen by the query planner for the exact WHERE clause used
 *      by GET /tasks/:id/events (plan check via EXPLAIN FORMAT JSON, with
 *      enable_seqscan disabled so the planner cannot fall back to a sequential
 *      scan even on a small table).
 *
 * The suite skips automatically when DATABASE_URL is not set.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import {
  db,
  organizationsTable,
  rolesTable,
  orgMembersTable,
  usersTable,
  workflowStagesTable,
  tasksTable,
  taskEventsTable,
  OWNER_PERMISSIONS,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Skip when no real database is available
// ---------------------------------------------------------------------------
const describeIf = process.env.DATABASE_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Seed state
// ---------------------------------------------------------------------------
let orgId: string;
let taskId: number;
let userId: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(suffix: string): Promise<string> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `index-test-${suffix}-${Date.now()}@test.local`,
      firstName: "Index",
      lastName: suffix,
    })
    .returning({ id: usersTable.id });
  return row.id;
}

async function seedOrg(): Promise<string> {
  const [org] = await db
    .insert(organizationsTable)
    .values({ name: "Index Test Org" })
    .returning({ id: organizationsTable.id });
  return org.id;
}

async function seedRole(orgIdVal: string, ownerUserId: string): Promise<void> {
  const [role] = await db
    .insert(rolesTable)
    .values({ orgId: orgIdVal, name: "Owner", isBuiltIn: true, isOwner: true, permissions: OWNER_PERMISSIONS })
    .returning({ id: rolesTable.id });
  await db.insert(orgMembersTable).values({ orgId: orgIdVal, userId: ownerUserId, roleId: role.id });
}

async function seedStage(orgIdVal: string): Promise<string> {
  const [stage] = await db
    .insert(workflowStagesTable)
    .values({ orgId: orgIdVal, name: "To Do", color: "#6b7280", type: "open", position: 0 })
    .returning({ id: workflowStagesTable.id });
  return String(stage.id);
}

// Recursively walk a Postgres EXPLAIN JSON plan tree and collect all nodes.
function collectNodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  const nodes: any[] = [node];
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) nodes.push(...collectNodes(child));
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Seed before tests
// ---------------------------------------------------------------------------
beforeAll(async () => {
  userId = await createUser("events-index");
  orgId = await seedOrg();
  await seedRole(orgId, userId);
  const stageId = await seedStage(orgId);

  const [task] = await db
    .insert(tasksTable)
    .values({
      orgId,
      orgTaskNumber: 1,
      title: "Index Test Task",
      status: stageId,
      priority: "medium",
      category: "other",
    })
    .returning({ id: tasksTable.id });
  taskId = task.id;

  // Insert a handful of audit events so the planner has real data to reason about.
  await db.insert(taskEventsTable).values([
    { taskId, orgId, field: "created",  actorId: userId, actorName: "Index User", oldValue: null, newValue: null },
    { taskId, orgId, field: "status",   actorId: userId, actorName: "Index User", oldValue: "To Do", newValue: "In Progress" },
    { taskId, orgId, field: "priority", actorId: userId, actorName: "Index User", oldValue: "medium", newValue: "high" },
  ]);
});

// ---------------------------------------------------------------------------
// Cleanup after all tests
// ---------------------------------------------------------------------------
afterAll(async () => {
  if (orgId) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
  }
  if (userId) {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf("task_events index — structural check", () => {
  it("index task_events_task_id_org_id_idx exists in pg_indexes", async () => {
    const rows = await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM   pg_indexes
      WHERE  tablename  = 'task_events'
        AND  indexname  = 'task_events_task_id_org_id_idx'
    `);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].indexname).toBe("task_events_task_id_org_id_idx");
  });

  it("index covers both task_id and org_id columns (in that order)", async () => {
    const rows = await db.execute<{ attname: string; attnum: number }>(sql`
      SELECT a.attname, a.attnum
      FROM   pg_index      ix
      JOIN   pg_class      t  ON t.oid = ix.indrelid
      JOIN   pg_class      i  ON i.oid = ix.indexrelid
      JOIN   pg_attribute  a  ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE  t.relname = 'task_events'
        AND  i.relname = 'task_events_task_id_org_id_idx'
      ORDER  BY array_position(ix.indkey, a.attnum)
    `);
    const columnNames = rows.rows.map((r) => r.attname);
    expect(columnNames).toContain("task_id");
    expect(columnNames).toContain("org_id");
    // task_id must appear before org_id (leading column drives equality lookups)
    expect(columnNames.indexOf("task_id")).toBeLessThan(columnNames.indexOf("org_id"));
  });
});

describeIf("task_events index — query plan check", () => {
  it("planner uses an index scan on task_events_task_id_org_id_idx for the history query", async () => {
    // Run EXPLAIN inside a transaction with seqscan disabled.
    // SET LOCAL is scoped to the transaction so it does not affect other tests.
    const explainResult = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      return tx.execute<{ "QUERY PLAN": any[] }>(sql`
        EXPLAIN (FORMAT JSON)
        SELECT *
        FROM   task_events
        WHERE  task_id = ${taskId}
          AND  org_id  = ${orgId}
        ORDER  BY created_at ASC
      `);
    });

    // The first (and only) result row holds the plan as a JSON array.
    const planArray = explainResult.rows[0]["QUERY PLAN"] as any[];
    expect(Array.isArray(planArray)).toBe(true);

    const topPlan = planArray[0]?.Plan;
    expect(topPlan).toBeDefined();

    // Walk the plan tree and collect every node.
    const allNodes = collectNodes(topPlan);

    // There must be at least one Index Scan / Index Only Scan node on task_events.
    const indexNodes = allNodes.filter(
      (n) =>
        (n["Node Type"] === "Index Scan" || n["Node Type"] === "Index Only Scan" || n["Node Type"] === "Bitmap Index Scan") &&
        typeof n["Index Name"] === "string" &&
        n["Index Name"].includes("task_id_org_id"),
    );

    expect(indexNodes.length).toBeGreaterThan(0);
  });

  it("no sequential scan on task_events when seqscan is disabled", async () => {
    const explainResult = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      return tx.execute<{ "QUERY PLAN": any[] }>(sql`
        EXPLAIN (FORMAT JSON)
        SELECT *
        FROM   task_events
        WHERE  task_id = ${taskId}
          AND  org_id  = ${orgId}
        ORDER  BY created_at ASC
      `);
    });

    const planArray = explainResult.rows[0]["QUERY PLAN"] as any[];
    const topPlan = planArray[0]?.Plan;
    const allNodes = collectNodes(topPlan);

    const seqScanNodes = allNodes.filter(
      (n) => n["Node Type"] === "Seq Scan" && n["Relation Name"] === "task_events",
    );
    expect(seqScanNodes).toHaveLength(0);
  });
});
