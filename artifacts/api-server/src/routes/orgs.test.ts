/**
 * Tests for orgs routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - POST /orgs                              - create org: validation, 409 already in org, 201
 *  - GET  /orgs/me                           - has org, has pending invitation, neither
 *  - PATCH /orgs/me                          - body validation, 200 on success
 *  - GET  /orgs/members                      - 200 with member list
 *  - GET  /orgs/invitation-preview/:token    - 404 not found/expired, 200 valid
 *  - GET  /orgs/invitations                  - 200 with list
 *  - DELETE /orgs/invitations/:id            - 404, 204
 *  - POST /orgs/invite                       - 400 no email/userId, 409 already member, 201
 *  - POST /orgs/invitations/:token/accept    - 404, 403 wrong user, 409 already in org, 200
 *  - POST /orgs/invitations/:token/decline   - 404, 403 wrong user, 200
 *  - DELETE /orgs/members/:userId            - 400 self-remove, 404, 204
 *  - PATCH /orgs/members/:userId/role        - 400 invalid role, 404, 200
 *  - POST /orgs/leave                        - sole member deletes org, sole admin blocked, 200
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertQueue: [] as any[][], // each entry is the result of one insert().values().returning()
  updateQueue: [] as any[][], // each entry is the result of one update chain
  isOrgOwner: true, // configurable: set false to simulate a non-owner admin
  updateCalls: 0, // incremented whenever db.update() is invoked
  deleteCalls: 0, // incremented whenever db.delete() is invoked
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
      limit: () => Promise.resolve(result),
      orderBy: () => Promise.resolve(result),
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(result).catch(onrejected);
      },
    };
    return chain;
  }

  // A thenable "no-op" result - used when the code awaits insert/update/delete
  // without calling .returning() (e.g. db.insert(t).values(d) or db.delete(t).where(...)).
  function noop(): any {
    return {
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve().then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve().catch(onrejected);
      },
    };
  }

  const dbMock: any = {
      select: () => makeChain(mockState.selectQueue.shift() ?? []),
      insert: () => ({
        values: () => {
          const next = mockState.insertQueue.shift() ?? [];
          return Object.assign(noop(), {
            returning: () => Promise.resolve(next),
          });
        },
      }),
      update: () => (mockState.updateCalls++, {
        set: () => ({
          where: () => {
            const next = mockState.updateQueue.shift() ?? [];
            return Object.assign(noop(), {
              returning: () => Promise.resolve(next),
            });
          },
        }),
      }),
      delete: () => (mockState.deleteCalls++, {
        where: () => noop(),
      }),
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
    OWNER_PERMISSIONS: {},
    ADMIN_PERMISSIONS: {},
    MEMBER_PERMISSIONS: {},
    ALL_PERMISSIONS: [],
    eq: () => ({}),
    and: () => ({}),
    or: () => ({}),
    sql: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  sql: () => ({}),
}));

// requireAuth injects req.user; requireOrg also injects orgId + role.
// Guards are stubbed — we test business logic, not the guards themselves.
const ALL_PERMS = {
  view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
  delete_tasks: true, manage_projects: true, manage_org_settings: true,
  manage_members: true, manage_webhooks: true, manage_api_keys: true,
  manage_custom_fields: true, manage_workflow_stages: true, manage_sla_policies: true,
  manage_task_templates: true, manage_saved_views: true, view_audit_log: true,
};
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "user-owner" };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.user = { id: "user-owner" };
    req.orgId = "test-org";
    req.orgRole = "admin";
    req.orgRoleId = mockState.isOrgOwner ? "role-owner" : "role-admin";
    req.orgRoleName = mockState.isOrgOwner ? "Owner" : "Admin";
    req.isOrgOwner = mockState.isOrgOwner;
    req.orgPermissions = ALL_PERMS;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => {
    next();
  },
  requireOwner: (_req: any, _res: any, next: any) => {
    next();
  },
  requirePermission: (_key: string) => (_req: any, _res: any, next: any) => {
    next();
  },
}));

import orgsRouter from "./orgs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", orgsRouter);
  return app;
}

const MOCK_ORG = {
  id: "org-1",
  name: "Acme Corp",
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
};

const MEMBER_PERMS = {
  view_tasks: true, create_tasks: true, edit_tasks: true, close_tasks: true,
  delete_tasks: false, manage_projects: false, manage_org_settings: false,
  manage_members: false, manage_webhooks: false, manage_api_keys: false,
  manage_custom_fields: false, manage_workflow_stages: false, manage_sla_policies: false,
  manage_task_templates: false, manage_saved_views: false, view_audit_log: false,
};

const MOCK_MEMBER = {
  orgId: "test-org",
  userId: "user-owner",
  roleId: "role-owner",
  roleName: "Owner",
  permissions: ALL_PERMS,
  joinedAt: new Date("2024-01-01T00:00:00.000Z"),
};

const MOCK_INVITATION = {
  id: "inv-1",
  orgId: "test-org",
  invitedEmail: "bob@example.com",
  invitedUserId: null,
  invitedById: "user-owner",
  token: "abc123",
  status: "pending",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// POST /api/orgs
// ---------------------------------------------------------------------------

describe("POST /api/orgs", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue.length = 0;
    mockState.updateQueue.length = 0;
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp()).post("/api/orgs").send({});
    expect(res.status).toBe(400);
  });

  it("returns 409 when the user already belongs to an org", async () => {
    mockState.selectQueue.push([{ orgId: "existing-org" }]); // existing membership

    const res = await request(buildApp()).post("/api/orgs").send({ name: "New Org" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/already belong/i) });
  });

  it("returns 201 with org and role on success", async () => {
    mockState.selectQueue.push([]); // no existing membership
    mockState.insertQueue.push([MOCK_ORG]); // insert org → returning
    mockState.insertQueue.push([{ id: "role-owner" }]); // insert Owner role → returning
    mockState.insertQueue.push([]); // insert Admin role → noop
    mockState.insertQueue.push([{ id: "role-member" }]); // insert Member role → returning
    // insert org member → queue empty, noop

    const res = await request(buildApp()).post("/api/orgs").send({ name: "Acme Corp" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ org: { name: "Acme Corp" }, role: "admin" });
  });
});

// ---------------------------------------------------------------------------
// GET /api/orgs/me
// ---------------------------------------------------------------------------

describe("GET /api/orgs/me", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue.length = 0;
    mockState.updateQueue.length = 0;
  });

  it("returns org and role when the user is a member", async () => {
    mockState.selectQueue.push([{
      orgId: "test-org",
      roleId: "role-owner",
      roleName: "Owner",
      isOwner: true,
      permissions: ALL_PERMS,
      orgName: "Acme Corp",
      orgCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
    }]);

    const res = await request(buildApp()).get("/api/orgs/me");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ org: { name: "Acme Corp" }, role: "admin", pendingInvitation: null });
  });

  it("returns pending invitation when user has no org but has an invite", async () => {
    mockState.selectQueue.push([]); // no membership
    mockState.selectQueue.push([{ email: "owner@example.com" }]); // user email
    mockState.selectQueue.push([{
      id: "inv-1",
      orgId: "other-org",
      orgName: "Other Corp",
      token: "xyz",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    }]);

    const res = await request(buildApp()).get("/api/orgs/me");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ org: null, role: null, pendingInvitation: { token: "xyz" } });
  });

  it("returns nulls when user has no org and no invitation", async () => {
    mockState.selectQueue.push([]); // no membership
    mockState.selectQueue.push([{ email: "owner@example.com" }]); // user email
    mockState.selectQueue.push([]); // no invitation

    const res = await request(buildApp()).get("/api/orgs/me");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ org: null, role: null, pendingInvitation: null });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/orgs/me
// ---------------------------------------------------------------------------

describe("PATCH /api/orgs/me", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue.length = 0;
    mockState.updateQueue.length = 0;
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp()).patch("/api/orgs/me").send({});
    expect(res.status).toBe(400);
  });

  it("returns 200 with the updated org name", async () => {
    const updated = { ...MOCK_ORG, name: "Renamed Corp" };
    mockState.updateQueue.push([updated]);

    const res = await request(buildApp()).patch("/api/orgs/me").send({ name: "Renamed Corp" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed Corp" });
  });
});

// ---------------------------------------------------------------------------
// GET /api/orgs/members
// ---------------------------------------------------------------------------

describe("GET /api/orgs/members", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 200 with member list", async () => {
    mockState.selectQueue.push([{
      userId: "user-owner",
      roleId: "role-owner",
      roleName: "Owner",
      isOwner: true,
      permissions: ALL_PERMS,
      joinedAt: new Date("2024-01-01T00:00:00.000Z"),
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      profileImageUrl: null,
    }]);

    const res = await request(buildApp()).get("/api/orgs/members");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ userId: "user-owner", role: "admin", roleName: "Owner", email: "alice@example.com" });
  });

  it("returns 200 with an empty array when there are no members", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/orgs/members");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/orgs/invitation-preview/:token
// ---------------------------------------------------------------------------

describe("GET /api/orgs/invitation-preview/:token", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 404 when the token does not exist", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/orgs/invitation-preview/bad-token");

    expect(res.status).toBe(404);
  });

  it("returns 404 when the invitation is expired", async () => {
    mockState.selectQueue.push([{
      orgName: "Acme Corp",
      expiresAt: new Date(Date.now() - 1000), // in the past
      status: "pending",
    }]);

    const res = await request(buildApp()).get("/api/orgs/invitation-preview/expired-token");

    expect(res.status).toBe(404);
  });

  it("returns 404 when the invitation is not pending", async () => {
    mockState.selectQueue.push([{
      orgName: "Acme Corp",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      status: "accepted",
    }]);

    const res = await request(buildApp()).get("/api/orgs/invitation-preview/used-token");

    expect(res.status).toBe(404);
  });

  it("returns 200 with org name for a valid pending token", async () => {
    mockState.selectQueue.push([{
      orgName: "Acme Corp",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "pending",
    }]);

    const res = await request(buildApp()).get("/api/orgs/invitation-preview/valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orgName: "Acme Corp" });
  });
});

// ---------------------------------------------------------------------------
// GET /api/orgs/invitations
// ---------------------------------------------------------------------------

describe("GET /api/orgs/invitations", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 200 with an empty array when there are no pending invitations", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/orgs/invitations");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with pending invitations", async () => {
    mockState.selectQueue.push([MOCK_INVITATION]);

    const res = await request(buildApp()).get("/api/orgs/invitations");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ token: "abc123", status: "pending" });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/orgs/invitations/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/orgs/invitations/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 404 when the invitation is not found", async () => {
    mockState.selectQueue.push([]); // not found

    const res = await request(buildApp()).delete("/api/orgs/invitations/inv-999");

    expect(res.status).toBe(404);
  });

  it("returns 204 on successful cancellation", async () => {
    mockState.selectQueue.push([{ id: "inv-1", orgId: "test-org" }]); // found

    const res = await request(buildApp()).delete("/api/orgs/invitations/inv-1");

    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST /api/orgs/invite
// ---------------------------------------------------------------------------

describe("POST /api/orgs/invite", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue.length = 0;
  });

  it("returns 400 when neither email nor userId is provided", async () => {
    const res = await request(buildApp()).post("/api/orgs/invite").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid email format", async () => {
    const res = await request(buildApp()).post("/api/orgs/invite").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when inviting by userId and user is already a member", async () => {
    mockState.selectQueue.push([{ userId: "user-2" }]); // already a member

    const res = await request(buildApp())
      .post("/api/orgs/invite")
      .send({ userId: "user-2" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/already a member/i) });
  });

  it("returns 201 with the invitation when inviting by email", async () => {
    mockState.insertQueue.push([MOCK_INVITATION]);

    const res = await request(buildApp())
      .post("/api/orgs/invite")
      .send({ email: "bob@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ token: "abc123", status: "pending", invitedEmail: "bob@example.com" });
  });

  it("returns 201 when inviting by userId (not already a member)", async () => {
    mockState.selectQueue.push([]); // not already a member
    const inv = { ...MOCK_INVITATION, invitedEmail: null, invitedUserId: "user-2" };
    mockState.insertQueue.push([inv]);

    const res = await request(buildApp())
      .post("/api/orgs/invite")
      .send({ userId: "user-2" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ invitedUserId: "user-2", status: "pending" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/orgs/invitations/:token/accept
// ---------------------------------------------------------------------------

describe("POST /api/orgs/invitations/:token/accept", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue.length = 0;
    mockState.updateQueue.length = 0;
  });

  it("returns 404 when the invitation does not exist or is expired", async () => {
    mockState.selectQueue.push([{ email: "owner@example.com" }]); // user
    mockState.selectQueue.push([]); // invitation not found

    const res = await request(buildApp()).post("/api/orgs/invitations/bad-token/accept");

    expect(res.status).toBe(404);
  });

  it("returns 403 when the invitation is not for the current user", async () => {
    mockState.selectQueue.push([{ email: "different@example.com" }]); // user email doesn't match
    mockState.selectQueue.push([{ ...MOCK_INVITATION, invitedEmail: "other@example.com", invitedUserId: "other-user" }]);

    const res = await request(buildApp()).post("/api/orgs/invitations/abc123/accept");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/not for you/i) });
  });

  it("returns 409 when the user already belongs to an org", async () => {
    mockState.selectQueue.push([{ email: "bob@example.com" }]); // user email matches
    mockState.selectQueue.push([{ ...MOCK_INVITATION, invitedEmail: "bob@example.com" }]); // invitation matches by email
    mockState.selectQueue.push([{ orgId: "existing-org" }]); // already a member

    const res = await request(buildApp()).post("/api/orgs/invitations/abc123/accept");

    expect(res.status).toBe(409);
  });

  it("returns 200 and org data on successful accept (email match)", async () => {
    mockState.selectQueue.push([{ email: "bob@example.com" }]); // user email
    mockState.selectQueue.push([{ ...MOCK_INVITATION, invitedEmail: "bob@example.com" }]); // invitation
    mockState.selectQueue.push([]); // no existing membership
    mockState.selectQueue.push([{ id: "role-member" }]); // getMemberRoleId
    mockState.insertQueue.push([]); // insert org member
    mockState.updateQueue.push([]); // update invitation status
    // getOrgMeData - membership select for the response
    mockState.selectQueue.push([{
      orgId: "test-org", roleId: "role-member", roleName: "Member",
      isOwner: false, permissions: MEMBER_PERMS,
      orgName: "Acme Corp", orgCreatedAt: new Date(),
    }]);

    const res = await request(buildApp()).post("/api/orgs/invitations/abc123/accept");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ org: { name: "Acme Corp" }, role: "member" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/orgs/invitations/:token/decline
// ---------------------------------------------------------------------------

describe("POST /api/orgs/invitations/:token/decline", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateQueue.length = 0;
  });

  it("returns 404 when the invitation does not exist", async () => {
    mockState.selectQueue.push([{ email: "owner@example.com" }]); // user
    mockState.selectQueue.push([]); // invitation not found

    const res = await request(buildApp()).post("/api/orgs/invitations/bad-token/decline");

    expect(res.status).toBe(404);
  });

  it("returns 403 when the invitation is not for the current user", async () => {
    mockState.selectQueue.push([{ email: "different@example.com" }]);
    mockState.selectQueue.push([{ ...MOCK_INVITATION, invitedEmail: "other@example.com", invitedUserId: "other-user" }]);

    const res = await request(buildApp()).post("/api/orgs/invitations/abc123/decline");

    expect(res.status).toBe(403);
  });

  it("returns 200 on successful decline (email match)", async () => {
    mockState.selectQueue.push([{ email: "bob@example.com" }]);
    mockState.selectQueue.push([{ ...MOCK_INVITATION, invitedEmail: "bob@example.com" }]);
    mockState.updateQueue.push([]);

    const res = await request(buildApp()).post("/api/orgs/invitations/abc123/decline");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/orgs/members/:userId
// ---------------------------------------------------------------------------

describe("DELETE /api/orgs/members/:userId", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.isOrgOwner = true;
    mockState.deleteCalls = 0;
  });

  it("returns 400 when trying to remove yourself", async () => {
    // requireOrg mock injects req.user.id = "user-owner"
    const res = await request(buildApp()).delete("/api/orgs/members/user-owner");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/cannot remove yourself/i) });
  });

  it("returns 404 when the member does not exist", async () => {
    mockState.selectQueue.push([]); // member not found

    const res = await request(buildApp()).delete("/api/orgs/members/other-user");

    expect(res.status).toBe(404);
  });

  it("returns 204 on successful removal", async () => {
    mockState.selectQueue.push([MOCK_MEMBER]); // member found

    const res = await request(buildApp()).delete("/api/orgs/members/other-user");

    expect(res.status).toBe(204);
  });

  it("returns 403 when a non-owner admin tries to remove an Owner", async () => {
    mockState.isOrgOwner = false;
    // target member has the Owner role
    mockState.selectQueue.push([{ roleId: "role-owner", isOwner: true }]);

    const res = await request(buildApp()).delete("/api/orgs/members/user-owner-2");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/owner/i) });
    expect(mockState.deleteCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/orgs/members/:userId/role
// ---------------------------------------------------------------------------

describe("PATCH /api/orgs/members/:userId/role", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateQueue.length = 0;
    mockState.isOrgOwner = true;
    mockState.updateCalls = 0;
    mockState.deleteCalls = 0;
  });

  it("returns 400 when roleId is missing", async () => {
    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when the member does not exist", async () => {
    mockState.selectQueue.push([]); // member not found

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({ roleId: "role-admin" });

    expect(res.status).toBe(404);
  });

  it("returns 200 with updated member when assigning admin role", async () => {
    const adminRole = { id: "role-admin", name: "Admin", isOwner: false, permissions: ALL_PERMS };
    mockState.selectQueue.push([MOCK_MEMBER]); // target member found
    mockState.selectQueue.push([adminRole]); // target role found
    mockState.updateQueue.push([{ ...MOCK_MEMBER, userId: "user-2", roleId: "role-admin" }]);
    mockState.selectQueue.push([{ firstName: "Bob", lastName: "Jones", email: "bob@example.com", profileImageUrl: null }]);

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({ roleId: "role-admin" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: "admin", email: "bob@example.com" });
  });

  it("returns 200 with updated member when assigning member role", async () => {
    const memberRole = { id: "role-member", name: "Member", isOwner: false, permissions: MEMBER_PERMS };
    mockState.selectQueue.push([MOCK_MEMBER]); // target found
    mockState.selectQueue.push([memberRole]); // target role found
    mockState.updateQueue.push([{ ...MOCK_MEMBER, userId: "user-2", roleId: "role-member" }]);
    mockState.selectQueue.push([{ firstName: "Bob", lastName: "Jones", email: "bob@example.com", profileImageUrl: null }]);

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({ roleId: "role-member" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: "member" });
  });

  it("returns 403 when a non-owner admin tries to change the Owner's role", async () => {
    mockState.isOrgOwner = false;
    // target member is the Owner
    mockState.selectQueue.push([{ roleId: "role-owner", currentRoleIsOwner: true }]);

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-owner/role")
      .send({ roleId: "role-member" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/owner/i) });
    expect(mockState.updateCalls).toBe(0);
  });

  it("returns 403 when a non-owner admin tries to assign the Owner role", async () => {
    mockState.isOrgOwner = false;
    // target member is a regular member
    mockState.selectQueue.push([{ roleId: "role-member", currentRoleIsOwner: false }]);
    // target role is the Owner role
    mockState.selectQueue.push([{ id: "role-owner", name: "Owner", isOwner: true, permissions: ALL_PERMS }]);

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({ roleId: "role-owner" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/owner/i) });
    expect(mockState.updateCalls).toBe(0);
  });

  it("transfers ownership: assigning Owner role demotes the acting owner to Admin", async () => {
    mockState.selectQueue.push([{ roleId: "role-member", currentRoleIsOwner: false }]); // target member
    mockState.selectQueue.push([{ id: "role-owner", name: "Owner", isOwner: true, permissions: ALL_PERMS }]); // target role
    mockState.selectQueue.push([{ id: "role-admin" }]); // built-in Admin role lookup
    mockState.updateQueue.push([{ ...MOCK_MEMBER, userId: "user-2", roleId: "role-owner" }]); // promote target
    mockState.updateQueue.push([{ ...MOCK_MEMBER, roleId: "role-admin" }]); // demote acting owner
    mockState.selectQueue.push([{ firstName: "Bob", lastName: "Jones", email: "bob@example.com", profileImageUrl: null }]);

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({ roleId: "role-owner" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ roleName: "Owner", userId: "user-2" });
    expect(mockState.updateCalls).toBe(2); // target promoted AND actor demoted
  });

  it("fails the whole transfer when demoting the previous owner fails (no partial state)", async () => {
    mockState.selectQueue.push([{ roleId: "role-member", currentRoleIsOwner: false }]); // target member
    mockState.selectQueue.push([{ id: "role-owner", name: "Owner", isOwner: true, permissions: ALL_PERMS }]); // target role
    mockState.selectQueue.push([{ id: "role-admin" }]); // built-in Admin role
    mockState.updateQueue.push([{ ...MOCK_MEMBER, userId: "user-2", roleId: "role-owner" }]); // promote succeeds
    mockState.updateQueue.push([]); // demote returns no row → transaction throws → rollback

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({ roleId: "role-owner" });

    expect(res.status).toBe(500); // surfaced as an error, not a silent partial success
  });

  it("returns 500 without any writes when the built-in Admin role is missing during transfer", async () => {
    mockState.selectQueue.push([{ roleId: "role-member", currentRoleIsOwner: false }]); // target member
    mockState.selectQueue.push([{ id: "role-owner", name: "Owner", isOwner: true, permissions: ALL_PERMS }]); // target role
    mockState.selectQueue.push([]); // Admin role not found

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-2/role")
      .send({ roleId: "role-owner" });

    expect(res.status).toBe(500);
    expect(mockState.updateCalls).toBe(0);
  });

  it("returns 403 when an owner tries to change their own role", async () => {
    // requireOrg mock injects req.user.id = "user-owner" and isOrgOwner = true
    const res = await request(buildApp())
      .patch("/api/orgs/members/user-owner/role")
      .send({ roleId: "role-member" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/own role/i) });
    expect(mockState.updateCalls).toBe(0);
  });

  it("returns 400 when demoting the last remaining Owner (owner acting)", async () => {
    // owner demoting a different owner (not themselves)
    mockState.selectQueue.push([{ roleId: "role-owner", currentRoleIsOwner: true }]);
    mockState.selectQueue.push([{ id: "role-member", name: "Member", isOwner: false, permissions: MEMBER_PERMS }]);
    mockState.selectQueue.push([{ count: 1 }]); // only 1 owner left

    const res = await request(buildApp())
      .patch("/api/orgs/members/user-owner-2/role")
      .send({ roleId: "role-member" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/last owner/i) });
  });
});

// ---------------------------------------------------------------------------
// POST /api/orgs/leave
// ---------------------------------------------------------------------------

describe("POST /api/orgs/leave", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateQueue.length = 0;
  });

  it("deletes the org and returns success when the user is the sole member", async () => {
    mockState.selectQueue.push([{ count: 1 }]); // sole member

    const res = await request(buildApp()).post("/api/orgs/leave");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it("returns 400 when sole owner tries to leave a multi-member org", async () => {
    mockState.selectQueue.push([{ count: 3 }]); // multiple members
    // req.isOrgOwner = true from mock → checks owner count
    mockState.selectQueue.push([{ count: 1 }]); // only 1 owner

    const res = await request(buildApp()).post("/api/orgs/leave");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/transfer.*owner/i) });
  });

  it("removes the member and returns success when there are multiple owners", async () => {
    mockState.selectQueue.push([{ count: 3 }]); // multiple members
    mockState.selectQueue.push([{ count: 2 }]); // 2 owners → safe to leave

    const res = await request(buildApp()).post("/api/orgs/leave");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });
});
