/**
 * Body role injection tests — org member management routes.
 *
 * These tests confirm that sending a privileged field like { role: 'admin' }
 * in the request body has zero effect when the caller's server-side
 * orgPermissions.manage_members is false.  The real requirePermission
 * middleware runs (NOT mocked) so any future refactor that removes or
 * weakens the middleware would be caught immediately.
 *
 * Covered routes:
 *  POST   /api/orgs/invite
 *  PATCH  /api/orgs/members/:userId/role
 *  DELETE /api/orgs/members/:userId
 *  GET    /api/orgs/invitations          (also manage_members gated)
 *  DELETE /api/orgs/invitations/:id      (also manage_members gated)
 */

import { vi, describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Permissions fixture — manage_members is explicitly false
// ---------------------------------------------------------------------------
const MEMBER_PERMS = {
  view_tasks: true,  create_tasks: true, edit_tasks: true,  close_tasks: true,
  delete_tasks: false, manage_projects: false, manage_org_settings: false,
  manage_members: false, manage_webhooks: false, manage_api_keys: false,
  manage_custom_fields: false, manage_workflow_stages: false,
  manage_sla_policies: false, manage_task_templates: false,
  manage_saved_views: false, view_audit_log: false,
};

// ---------------------------------------------------------------------------
// Mock @workspace/db — handler is never reached (403 fires in the middleware),
// but orgs.ts imports the module at the top level so the mock must exist.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  const chain: any = {
    from: () => chain, where: () => chain, innerJoin: () => chain,
    leftJoin: () => chain, groupBy: () => chain, orderBy: () => chain,
    limit: () => Promise.resolve([]),
    then: (f: any, r: any) => Promise.resolve([]).then(f, r),
    catch: (r: any) => Promise.resolve([]).catch(r),
  };
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
      delete: () => ({ where: () => Object.assign(Promise.resolve([]), { returning: () => Promise.resolve([]) }) }),
      transaction: async (fn: any) => fn({ select: () => chain }),
    },
    organizationsTable: {}, orgMembersTable: {}, rolesTable: {},
    invitationsTable: {}, usersTable: {}, workflowStagesTable: {},
    OWNER_PERMISSIONS: {}, ADMIN_PERMISSIONS: {}, MEMBER_PERMISSIONS: {},
    ALL_PERMISSIONS: [],
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}), and: () => ({}), or: () => ({}), sql: () => ({}),
}));

vi.mock("../lib/webhook-dispatcher", () => ({
  dispatchMemberJoined: vi.fn(),
  dispatchMemberRemoved: vi.fn(),
}));

vi.mock("@workspace/api-zod", () => {
  const p = { parse: (x: any) => x, safeParse: (x: any) => ({ success: true, data: x }) };
  return {
    // Only the schemas actually imported by orgs.ts need to be listed here.
    // The passthrough is safe because handlers are never reached in these tests.
    InviteMemberBody: p, UpdateMemberRoleBody: p,
    ListMembersResponse: p, ListInvitationsResponse: p,
  };
});

// ---------------------------------------------------------------------------
// requireOrgMiddleware — keep the REAL requirePermission (and hasPermission)
// but stub the auth-injection middlewares to set manage_members: false.
//
// importOriginal returns the compiled module so requirePermission runs its
// actual check: `if (!req.orgPermissions?.[key]) → 403`.
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", async (importOriginal) => {
  const real = await importOriginal() as Record<string, unknown>;
  return {
    ...real, // includes the real requirePermission and hasPermission
    requireOrg: (req: any, _res: any, next: any) => {
      req.user = { id: "user-member" };
      req.orgId = "test-org";
      req.orgRoleId = "role-member";
      req.orgRoleName = "Member";
      req.isOrgOwner = false;
      req.orgPermissions = MEMBER_PERMS; // manage_members: false
      next();
    },
    requireOrgOrApiKey: (req: any, _res: any, next: any) => {
      req.user = { id: "user-member" };
      req.orgId = "test-org";
      req.orgRoleId = "role-member";
      req.orgRoleName = "Member";
      req.isOrgOwner = false;
      req.orgPermissions = MEMBER_PERMS;
      next();
    },
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: "user-member" };
      next();
    },
    requireAdmin: (_req: any, res: any) => {
      res.status(403).json({ error: "Permission required: admin" });
    },
    requireOwner: (_req: any, res: any) => {
      res.status(403).json({ error: "Permission required: owner" });
    },
    requireScope: () => (_req: any, _res: any, next: any) => next(),
  };
});

import orgsRouter from "./orgs.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", orgsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Member management routes — body role injection is blocked by server-side permission check", () => {
  it("POST /api/orgs/invite returns 403 when caller lacks manage_members, regardless of body content", async () => {
    // Sending role: 'admin' in the body must have no effect.
    // The real requirePermission('manage_members') fires before the handler
    // and returns 403 because req.orgPermissions.manage_members is false.
    const res = await request(buildApp())
      .post("/api/orgs/invite")
      .send({ email: "attacker@example.com", role: "admin" });

    expect(res.status).toBe(403);
    // Error cites the server-side permission key, not any body field.
    expect(res.body.error).toMatch(/manage_members/);
  });

  it("PATCH /api/orgs/members/:userId/role returns 403 when caller lacks manage_members", async () => {
    const res = await request(buildApp())
      .patch("/api/orgs/members/target-user/role")
      .send({ roleId: "role-admin", role: "admin" }); // body role field must be ignored

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manage_members/);
  });

  it("DELETE /api/orgs/members/:userId returns 403 when caller lacks manage_members", async () => {
    const res = await request(buildApp())
      .delete("/api/orgs/members/target-user")
      .send({ role: "admin" }); // spurious body role field must be ignored

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manage_members/);
  });

  it("GET /api/orgs/invitations returns 403 when caller lacks manage_members", async () => {
    const res = await request(buildApp()).get("/api/orgs/invitations");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manage_members/);
  });

  it("DELETE /api/orgs/invitations/:id returns 403 when caller lacks manage_members", async () => {
    const res = await request(buildApp())
      .delete("/api/orgs/invitations/inv-999");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/manage_members/);
  });
});
