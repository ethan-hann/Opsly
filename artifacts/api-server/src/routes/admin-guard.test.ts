/**
 * Integration tests: member callers are rejected by admin-only guards.
 *
 * Unlike the per-route unit tests (which stub out all middleware), these tests
 * run the REAL requireOrg / requirePermission / requireOwner middleware against
 * a mocked DB that returns Member-level data.  This ensures CI catches any route
 * that accidentally drops or mis-orders a guard.
 *
 * Covered guards / routes:
 *  - requirePermission('manage_org_settings') → PATCH /orgs/me
 *  - requirePermission('manage_members')      → GET  /orgs/invitations
 *  - requirePermission('manage_members')      → DELETE /orgs/invitations/:id
 *  - requirePermission('manage_members')      → POST /orgs/invite
 *  - requireOwner                             → POST /roles
 *  - requireOwner                             → PATCH /roles/:id
 *  - requireOwner                             → DELETE /roles/:id
 *
 * Each test asserts that a Member receives 403 and that the error body is
 * present (no silent pass-through or 500 due to a bad guard chain).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Hoisted constants — evaluated before vi.mock() factory functions run
// ---------------------------------------------------------------------------
const { mockState, MEMBER_PERMS, REAL_ALL_PERMISSIONS } = vi.hoisted(() => {
  const REAL_ALL_PERMISSIONS = [
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

  // Member has only the basic task permissions — no manage_* at all.
  const MEMBER_PERMS = Object.fromEntries(
    REAL_ALL_PERMISSIONS.map((k) => [
      k,
      (["view_tasks", "create_tasks", "edit_tasks", "close_tasks"] as string[]).includes(k),
    ]),
  ) as Record<(typeof REAL_ALL_PERMISSIONS)[number], boolean>;

  const mockState = {
    // Each entry is consumed by one db.select() chain (via .limit(1) or .orderBy())
    selectQueue: [] as any[][],
  };

  return { mockState, MEMBER_PERMS, REAL_ALL_PERMISSIONS };
});

// ---------------------------------------------------------------------------
// DB mock — requireOrg reads membership from the DB; we return Member-level data
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  // Membership row that requireOrg joins together
  const membershipRow = () => ({
    orgId: "test-org",
    roleId: "role-member",
    roleName: "Member",
    isOwner: false,           // ← not an owner
    permissions: MEMBER_PERMS, // ← Member-level only
    isDisabled: false,
  });

  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => Promise.resolve(result),
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

  function noop(): any {
    return {
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve().then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(undefined).catch(onrejected);
      },
    };
  }

  const dbMock: any = {
    select: () => {
      // Use the explicit queue if populated, otherwise fall back to a Member row
      const next = mockState.selectQueue.shift() ?? [membershipRow()];
      return makeChain(next);
    },
    insert: () => ({
      values: () => Object.assign(noop(), { returning: () => Promise.resolve([]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => Object.assign(noop(), { returning: () => Promise.resolve([]) }),
      }),
    }),
    delete: () => ({ where: () => noop() }),
    transaction: async (fn: any) => fn(dbMock),
  };

  return {
    db: dbMock,
    organizationsTable: {},
    orgMembersTable: {},
    rolesTable: {},
    invitationsTable: {},
    usersTable: {},
    workflowStagesTable: {},
    slaPoliciesTable: {},
    orgEventsTable: {},
    taskEventsTable: {},
    tasksTable: {},
    OWNER_PERMISSIONS: {},
    ADMIN_PERMISSIONS: {},
    MEMBER_PERMISSIONS: MEMBER_PERMS,
    ALL_PERMISSIONS: REAL_ALL_PERMISSIONS,
    eq: () => ({}),
    and: () => ({}),
    or: () => ({}),
    sql: () => ({}),
    isNull: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  sql: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  lt: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  gt: () => ({}),
  ne: () => ({}),
  not: () => ({}),
  inArray: () => ({}),
  notInArray: () => ({}),
  ilike: () => ({}),
}));

// Email / SSE helpers are not relevant to permission tests — stub them out.
vi.mock("../lib/email", () => ({
  sendMail: async () => ({ ok: true }),
  buildInviteEmail: () => "<html/>",
  isEmailConfigured: () => false,
}));

vi.mock("../lib/sse", () => ({
  pushEvent: () => undefined,
}));

vi.mock("../lib/workflow-stages", () => ({
  seedDefaultStages: async () => undefined,
}));

vi.mock("../lib/logger", () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));

// ---------------------------------------------------------------------------
// Import the REAL routers — guards run for real.
// (Import after all vi.mock() calls so the mocks are in place.)
// ---------------------------------------------------------------------------
import orgsRouter from "./orgs.js";
import rolesRouter from "./roles.js";

// ---------------------------------------------------------------------------
// Test app factory
// Injects req.user before the router so requireOrg finds an authenticated user.
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());

  // Simulate a logged-in session without touching the real auth middleware.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { id: "user-member" };
    next();
  });

  app.use("/api", orgsRouter);
  app.use("/api", rolesRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Convenience: prime the DB select queue with exactly one Member membership row
// (requireOrg reads this; subsequent selects are left empty so routes short-
//  circuit or return empty results rather than crashing).
// ---------------------------------------------------------------------------
function queueMemberMembership() {
  mockState.selectQueue.push([
    {
      orgId: "test-org",
      roleId: "role-member",
      roleName: "Member",
      isOwner: false,
      permissions: MEMBER_PERMS,
      isDisabled: false,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Admin-guard rejection: Member caller receives 403", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  // ─── Orgs routes ──────────────────────────────────────────────────────────

  describe("PATCH /api/orgs/me — requires manage_org_settings", () => {
    it("returns 403 for a Member", async () => {
      queueMemberMembership();

      const res = await request(buildApp())
        .patch("/api/orgs/me")
        .send({ name: "Hacked Org Name" });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("GET /api/orgs/invitations — requires manage_members", () => {
    it("returns 403 for a Member", async () => {
      queueMemberMembership();

      const res = await request(buildApp()).get("/api/orgs/invitations");

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("DELETE /api/orgs/invitations/:id — requires manage_members", () => {
    it("returns 403 for a Member", async () => {
      queueMemberMembership();

      const res = await request(buildApp()).delete("/api/orgs/invitations/inv-1");

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("POST /api/orgs/invite — requires manage_members", () => {
    it("returns 403 for a Member", async () => {
      queueMemberMembership();

      const res = await request(buildApp())
        .post("/api/orgs/invite")
        .send({ email: "newuser@example.com" });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  // ─── Roles routes ─────────────────────────────────────────────────────────

  describe("POST /api/roles — requires Owner", () => {
    it("returns 403 for a Member", async () => {
      queueMemberMembership();

      const res = await request(buildApp())
        .post("/api/roles")
        .send({ name: "Sneaky Role" });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("PATCH /api/roles/:id — requires Owner", () => {
    it("returns 403 for a Member", async () => {
      queueMemberMembership();

      const res = await request(buildApp())
        .patch("/api/roles/role-admin")
        .send({ name: "Renamed" });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("DELETE /api/roles/:id — requires Owner", () => {
    it("returns 403 for a Member", async () => {
      queueMemberMembership();

      const res = await request(buildApp()).delete("/api/roles/role-custom");

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });
});

// ---------------------------------------------------------------------------
// API-key rejection: admin guards must return 403 for API-key-authenticated
// requests even when the caller is also a valid org member.
//
// requirePermission() and requireOwner() call rejectApiKey() before any
// permission check when req.apiKeyId is set.  These tests verify that a
// future refactor cannot accidentally remove that check and silently allow
// API keys to reach session-only endpoints.
//
// The app factory sets BOTH req.user (so requireOrg can populate the request
// context from the DB) and req.apiKeyId (the key identity that triggers the
// rejection inside requirePermission / requireOwner).  A Member-level
// membership row is queued so requireOrg succeeds; the 403 is then produced
// by the rejectApiKey() early-return that runs before any permission check.
// ---------------------------------------------------------------------------

function buildApiKeyApp() {
  const app = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Provide a session user so requireOrg can resolve org membership from DB.
    (req as any).user = { id: "user-member" };
    // Set the API-key identity — this is what requirePermission / requireOwner
    // use to detect an API-key caller and invoke rejectApiKey().
    (req as any).apiKeyId = "key-abc-123";
    next();
  });

  app.use("/api", orgsRouter);
  app.use("/api", rolesRouter);
  return app;
}

describe("Admin-guard rejection: API-key caller receives 403 on session-only routes", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  // ─── requirePermission routes ─────────────────────────────────────────────

  it("PATCH /api/orgs/me — requirePermission('manage_org_settings') rejects API key", async () => {
    // requireOrg reads membership; queue a row so it succeeds before the guard runs.
    queueMemberMembership();

    const res = await request(buildApiKeyApp())
      .patch("/api/orgs/me")
      .send({ name: "Attempted Rename" });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    // Must be the rejectApiKey message, not a generic permission error.
    expect(res.body.error).toMatch(/session/i);
  });

  it("GET /api/orgs/invitations — requirePermission('manage_members') rejects API key", async () => {
    queueMemberMembership();

    const res = await request(buildApiKeyApp()).get("/api/orgs/invitations");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session/i);
  });

  it("DELETE /api/orgs/invitations/:id — requirePermission('manage_members') rejects API key", async () => {
    queueMemberMembership();

    const res = await request(buildApiKeyApp()).delete("/api/orgs/invitations/inv-1");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session/i);
  });

  it("POST /api/orgs/invite — requirePermission('manage_members') rejects API key", async () => {
    queueMemberMembership();

    const res = await request(buildApiKeyApp())
      .post("/api/orgs/invite")
      .send({ email: "attacker@evil.example" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session/i);
  });

  // ─── requireOwner routes ──────────────────────────────────────────────────

  it("POST /api/roles — requireOwner rejects API key", async () => {
    queueMemberMembership();

    const res = await request(buildApiKeyApp())
      .post("/api/roles")
      .send({ name: "Injected Role" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session/i);
  });

  it("PATCH /api/roles/:id — requireOwner rejects API key", async () => {
    queueMemberMembership();

    const res = await request(buildApiKeyApp())
      .patch("/api/roles/role-custom")
      .send({ name: "Hijacked" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session/i);
  });

  it("DELETE /api/roles/:id — requireOwner rejects API key", async () => {
    queueMemberMembership();

    const res = await request(buildApiKeyApp()).delete("/api/roles/role-custom");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session/i);
  });
});

// ---------------------------------------------------------------------------
// Sanity check: an Owner-level caller is NOT blocked by the same guards
// ---------------------------------------------------------------------------

const OWNER_PERMS = Object.fromEntries(
  REAL_ALL_PERMISSIONS.map((k) => [k, true]),
) as Record<(typeof REAL_ALL_PERMISSIONS)[number], boolean>;

describe("Admin-guard pass-through: Owner caller is not blocked by the guards", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  function queueOwnerMembership() {
    mockState.selectQueue.push([
      {
        orgId: "test-org",
        roleId: "role-owner",
        roleName: "Owner",
        isOwner: true,
        permissions: OWNER_PERMS,
        isDisabled: false,
      },
    ]);
  }

  it("PATCH /api/orgs/me — Owner reaches the handler (not 403)", async () => {
    queueOwnerMembership();
    // Handler will try to update; the mock returns nothing → guard is past, so
    // the response is not 403 (may be 200 or a handler-specific error, not a guard rejection).
    const res = await request(buildApp())
      .patch("/api/orgs/me")
      .send({ name: "Valid Rename" });

    expect(res.status).not.toBe(403);
  });

  it("POST /api/roles — Owner reaches the handler (not 403)", async () => {
    queueOwnerMembership();
    // No name-conflict row in queue → handler will 500 or succeed; either way not a guard 403.
    const res = await request(buildApp())
      .post("/api/roles")
      .send({ name: "New Role" });

    expect(res.status).not.toBe(403);
  });

  it("PATCH /api/roles/:id — Owner reaches the handler (not 403)", async () => {
    queueOwnerMembership();
    const res = await request(buildApp())
      .patch("/api/roles/role-custom")
      .send({ name: "Renamed" });

    expect(res.status).not.toBe(403);
  });

  it("DELETE /api/roles/:id — Owner reaches the handler (not 403)", async () => {
    queueOwnerMembership();
    const res = await request(buildApp()).delete("/api/roles/role-custom");

    expect(res.status).not.toBe(403);
  });
});

// ===========================================================================
// view_audit_log permission gate — GET /api/audit-log (#323)
// ===========================================================================

import auditLogRouter from "./audit-log.js";

describe("Admin-guard rejection: Member caller receives 403 on GET /api/audit-log", () => {
  // Reuse the existing selectQueue for the member role lookup
  function buildAuditApp() {
    const app = express();
    app.use(express.json());
    // Inject req.user exactly as buildApp() does — requireOrg needs this.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = { id: "user-member" };
      next();
    });
    app.use("/api", auditLogRouter);
    return app;
  }

  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 403 for a Member who lacks view_audit_log", async () => {
    // The REAL requireOrg middleware reads the orgMember+role row from the DB.
    // The mock returns a Member with MEMBER_PERMS (view_audit_log: false).
    // After requireOrg, audit-log.ts checks hasPermission(req, 'view_audit_log').
    mockState.selectQueue.push([{
      orgId: "test-org",
      roleId: "role-member",
      roleName: "Member",
      isOwner: false,
      permissions: MEMBER_PERMS,
      isDisabled: false,
    }]);

    const res = await request(buildAuditApp()).get("/api/org/audit-log");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("does NOT return 403 for an admin who has view_audit_log", async () => {
    // The key assertion: the permission guard must NOT block an admin caller.
    // The route may still return another status (e.g. 500 if downstream mock
    // queries fail) — that is a mock-complexity limitation, not a guard error.
    // The critical contract is: view_audit_log: true → no 403 from the guard.
    const adminPerms = { ...MEMBER_PERMS, view_audit_log: true };
    mockState.selectQueue.push([{
      orgId: "test-org",
      roleId: "role-admin",
      roleName: "Admin",
      isOwner: false,
      permissions: adminPerms,
      isDisabled: false,
    }]);
    // Extra empty entries for the audit-log route's internal DB queries
    mockState.selectQueue.push([]);
    mockState.selectQueue.push([]);
    mockState.selectQueue.push([]);

    const res = await request(buildAuditApp()).get("/api/org/audit-log");

    // 403 = permission denied.  Any other status means the guard passed.
    expect(res.status).not.toBe(403);
    expect(res.body?.error).not.toBe("Permission required: view_audit_log");
  });
});
