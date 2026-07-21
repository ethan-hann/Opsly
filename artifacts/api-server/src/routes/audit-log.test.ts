/**
 * Tests for GET /org/audit-log — permission gate and response shape.
 *
 * Runs the REAL requireOrg + hasPermission logic against a mocked DB so that
 * any future change that accidentally drops or mis-orders the view_audit_log
 * guard is caught immediately.
 *
 * Covered:
 *  - Member-role session → 403 (view_audit_log absent from permissions map)
 *  - Owner-role session  → 200 with { events: [], nextCursor: null } shape
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Hoisted permission maps — must be defined before vi.mock() factory runs
// ---------------------------------------------------------------------------
const { MEMBER_PERMS, OWNER_PERMS } = vi.hoisted(() => {
  const ALL_KEYS = [
    "view_tasks",
    "create_tasks",
    "edit_tasks",
    "close_tasks",
    "delete_tasks",
    "manage_projects",
    "manage_org_settings",
    "manage_members",
    "manage_webhooks",
    "manage_api_keys",
    "manage_custom_fields",
    "manage_workflow_stages",
    "manage_sla_policies",
    "manage_task_templates",
    "manage_saved_views",
    "view_audit_log",
  ] as const;

  const BASIC = new Set(["view_tasks", "create_tasks", "edit_tasks", "close_tasks"]);

  const MEMBER_PERMS = Object.fromEntries(
    ALL_KEYS.map((k) => [k, BASIC.has(k as string)]),
  ) as Record<(typeof ALL_KEYS)[number], boolean>;

  const OWNER_PERMS = Object.fromEntries(
    ALL_KEYS.map((k) => [k, true]),
  ) as Record<(typeof ALL_KEYS)[number], boolean>;

  return { MEMBER_PERMS, OWNER_PERMS };
});

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(result).catch(onrejected);
      },
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
      delete: () => ({ where: () => Promise.resolve([]) }),
    },
    organizationsTable: {},
    orgMembersTable: {},
    rolesTable: {},
    orgEventsTable: {},
    taskEventsTable: {},
    tasksTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: (...args: any[]) => args,
  or: () => ({}),
  gte: () => ({}),
  lte: () => ({}),
  lt: () => ({}),
  ilike: () => ({}),
  desc: () => ({}),
  asc: () => ({}),
  sql: () => ({}),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// ---------------------------------------------------------------------------
// Import the real router after mocks are registered
// ---------------------------------------------------------------------------
import auditLogRouter from "./audit-log.js";

// ---------------------------------------------------------------------------
// App factory — injects a session user before the router.
// The caller is responsible for priming mockState.selectQueue BEFORE calling
// this function so that requireOrg receives the membership row first.
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject an authenticated user (mirrors what the real auth middleware does).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { id: "user-1" };
    next();
  });

  app.use("/api", auditLogRouter);
  return app;
}

function membershipRow(permissions: Record<string, boolean>) {
  return {
    orgId: "org-1",
    roleId: "role-1",
    roleName: permissions["view_audit_log"] ? "Owner" : "Member",
    isOwner: Boolean(permissions["view_audit_log"]),
    permissions,
    isDisabled: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/org/audit-log — view_audit_log permission gate", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 403 when the caller is a Member (view_audit_log absent)", async () => {
    // requireOrg consumes the membership row; the permission check then rejects.
    mockState.selectQueue.push([membershipRow(MEMBER_PERMS)]);

    const res = await request(buildApp()).get("/api/org/audit-log");

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with { events, nextCursor } when the caller has view_audit_log", async () => {
    // 1. requireOrg membership lookup
    mockState.selectQueue.push([membershipRow(OWNER_PERMS)]);
    // 2. org events select (route does db.select().from(orgEventsTable)...)
    mockState.selectQueue.push([]);
    // 3. task events select (route does db.select({...}).from(taskEventsTable)...)
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/org/audit-log");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("events");
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body).toHaveProperty("nextCursor");
    // No events → no next page
    expect(res.body.nextCursor).toBeNull();
  });
});
