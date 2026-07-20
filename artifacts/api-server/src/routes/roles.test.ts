/**
 * Tests for roles routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /roles                    - 200 with sorted list
 *  - POST /roles                    - validation, 409 duplicate name, 201 success
 *  - POST /roles (full perms)       - every ALL_PERMISSIONS key accepted in body
 *  - PATCH /roles/:id               - 404, 403 on Owner built-in, 403 on Admin built-in,
 *                                     403 on Member built-in, 200 on custom role
 *  - PATCH /roles/:id (full perms)  - every ALL_PERMISSIONS key accepted on custom role
 *  - DELETE /roles/:id              - 404, 403 on built-in, 204 on custom role
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Hoisted constants — defined before vi.mock factories are evaluated
// ---------------------------------------------------------------------------
const { mockState, REAL_ALL_PERMISSIONS, ALL_PERMS_TRUE, MEMBER_PERMS } = vi.hoisted(() => {
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

  const ALL_PERMS_TRUE = Object.fromEntries(
    REAL_ALL_PERMISSIONS.map((k) => [k, true]),
  ) as Record<(typeof REAL_ALL_PERMISSIONS)[number], boolean>;

  const MEMBER_PERMS = Object.fromEntries(
    REAL_ALL_PERMISSIONS.map((k) => [k, false]),
  ) as Record<(typeof REAL_ALL_PERMISSIONS)[number], boolean>;

  const mockState = {
    selectQueue: [] as any[][],
    insertQueue: [] as any[][],
    updateQueue: [] as any[][],
    updateCalls: 0,
    deleteCalls: 0,
  };

  return { mockState, REAL_ALL_PERMISSIONS, ALL_PERMS_TRUE, MEMBER_PERMS };
});

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
    rolesTable: {},
    orgMembersTable: {},
    ALL_PERMISSIONS: REAL_ALL_PERMISSIONS,
    MEMBER_PERMISSIONS: MEMBER_PERMS,
    eq: () => ({}),
    and: () => ({}),
    sql: () => ({}),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  sql: () => ({}),
}));

// ---------------------------------------------------------------------------
// Mock requireOrgMiddleware — guards are stubbed; we test business logic only
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireOrg: (req: any, _res: any, next: any) => {
    req.user = { id: "user-owner" };
    req.orgId = "test-org";
    req.isOrgOwner = true;
    req.orgPermissions = ALL_PERMS_TRUE;
    next();
  },
  requireOwner: (_req: any, _res: any, next: any) => next(),
}));

import rolesRouter from "./roles.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", rolesRouter);
  return app;
}

const MOCK_OWNER_ROLE = {
  id: "role-owner",
  orgId: "test-org",
  name: "Owner",
  isBuiltIn: true,
  isOwner: true,
  permissions: ALL_PERMS_TRUE,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
};

const MOCK_ADMIN_ROLE = {
  id: "role-admin",
  orgId: "test-org",
  name: "Admin",
  isBuiltIn: true,
  isOwner: false,
  permissions: ALL_PERMS_TRUE,
  createdAt: new Date("2024-01-01T00:00:01.000Z"),
};

const MOCK_MEMBER_ROLE = {
  id: "role-member",
  orgId: "test-org",
  name: "Member",
  isBuiltIn: true,
  isOwner: false,
  permissions: MEMBER_PERMS,
  createdAt: new Date("2024-01-01T00:00:02.000Z"),
};

const MOCK_CUSTOM_ROLE = {
  id: "role-custom",
  orgId: "test-org",
  name: "Support",
  isBuiltIn: false,
  isOwner: false,
  permissions: MEMBER_PERMS,
  createdAt: new Date("2024-01-02T00:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// GET /api/roles
// ---------------------------------------------------------------------------

describe("GET /api/roles", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
  });

  it("returns 200 with built-in roles first then custom alphabetically", async () => {
    mockState.selectQueue.push([MOCK_CUSTOM_ROLE, MOCK_OWNER_ROLE, MOCK_ADMIN_ROLE, MOCK_MEMBER_ROLE]);

    const res = await request(buildApp()).get("/api/roles");

    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.name)).toEqual(["Owner", "Admin", "Member", "Support"]);
  });

  it("returns 200 with empty array when no roles exist", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get("/api/roles");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/roles
// ---------------------------------------------------------------------------

describe("POST /api/roles", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.insertQueue.length = 0;
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(buildApp()).post("/api/roles").send({});
    expect(res.status).toBe(400);
  });

  it("returns 409 when name already exists in the org", async () => {
    mockState.selectQueue.push([{ id: "existing-role" }]); // name conflict check

    const res = await request(buildApp()).post("/api/roles").send({ name: "Support" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/already exists/i) });
  });

  it("returns 201 with new role on success", async () => {
    mockState.selectQueue.push([]); // no name conflict
    mockState.insertQueue.push([MOCK_CUSTOM_ROLE]);

    const res = await request(buildApp()).post("/api/roles").send({ name: "Support" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Support", isBuiltIn: false });
  });

  it("accepts every ALL_PERMISSIONS key when creating a custom role", async () => {
    mockState.selectQueue.push([]); // no name conflict
    const created = { ...MOCK_CUSTOM_ROLE, permissions: ALL_PERMS_TRUE };
    mockState.insertQueue.push([created]);

    const res = await request(buildApp())
      .post("/api/roles")
      .send({ name: "Power User", permissions: ALL_PERMS_TRUE });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Support", isBuiltIn: false });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/roles/:id — built-in role immutability
// ---------------------------------------------------------------------------

describe("PATCH /api/roles/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.updateQueue.length = 0;
  });

  it("returns 404 when role does not exist", async () => {
    mockState.selectQueue.push([]); // role not found

    const res = await request(buildApp())
      .patch("/api/roles/nonexistent")
      .send({ name: "Renamed" });

    expect(res.status).toBe(404);
  });

  it("returns 403 with hint when patching the Owner built-in role", async () => {
    mockState.selectQueue.push([MOCK_OWNER_ROLE]);

    const res = await request(buildApp())
      .patch("/api/roles/role-owner")
      .send({ name: "Renamed" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/Owner.*built-in/i),
      hint: expect.stringMatching(/custom role/i),
    });
  });

  it("returns 403 with hint when patching the Admin built-in role", async () => {
    mockState.selectQueue.push([MOCK_ADMIN_ROLE]);

    const res = await request(buildApp())
      .patch("/api/roles/role-admin")
      .send({ name: "Renamed" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/Admin.*built-in/i),
      hint: expect.stringMatching(/custom role/i),
    });
  });

  it("returns 403 with hint when patching the Member built-in role", async () => {
    mockState.selectQueue.push([MOCK_MEMBER_ROLE]);

    const res = await request(buildApp())
      .patch("/api/roles/role-member")
      .send({ name: "Renamed" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/Member.*built-in/i),
      hint: expect.stringMatching(/custom role/i),
    });
  });

  it("returns 200 when patching a custom role name", async () => {
    mockState.selectQueue.push([MOCK_CUSTOM_ROLE]); // role found
    mockState.selectQueue.push([]); // no name conflict
    const updated = { ...MOCK_CUSTOM_ROLE, name: "Level 2 Support" };
    mockState.updateQueue.push([updated]);

    const res = await request(buildApp())
      .patch("/api/roles/role-custom")
      .send({ name: "Level 2 Support" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Level 2 Support", isBuiltIn: false });
  });

  it("accepts every ALL_PERMISSIONS key when patching a custom role", async () => {
    mockState.selectQueue.push([MOCK_CUSTOM_ROLE]); // role found (no name change → no conflict check)
    const updated = { ...MOCK_CUSTOM_ROLE, permissions: ALL_PERMS_TRUE };
    mockState.updateQueue.push([updated]);

    const res = await request(buildApp())
      .patch("/api/roles/role-custom")
      .send({ permissions: ALL_PERMS_TRUE });

    expect(res.status).toBe(200);
    // Every permission key should be present in the response
    for (const key of REAL_ALL_PERMISSIONS) {
      expect(res.body.permissions).toHaveProperty(key);
    }
  });

  it("returns 409 when renaming a custom role to an existing name", async () => {
    mockState.selectQueue.push([MOCK_CUSTOM_ROLE]); // role found
    mockState.selectQueue.push([{ id: "other-role" }]); // name conflict

    const res = await request(buildApp())
      .patch("/api/roles/role-custom")
      .send({ name: "Admin" });

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/roles/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/roles/:id", () => {
  beforeEach(() => {
    mockState.selectQueue.length = 0;
    mockState.deleteCalls = 0;
    mockState.updateCalls = 0;
  });

  it("returns 404 when role does not exist", async () => {
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).delete("/api/roles/nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 403 with hint when deleting any built-in role", async () => {
    for (const builtIn of [MOCK_OWNER_ROLE, MOCK_ADMIN_ROLE, MOCK_MEMBER_ROLE]) {
      mockState.selectQueue.push([builtIn]);

      const res = await request(buildApp()).delete(`/api/roles/${builtIn.id}`);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        hint: expect.stringMatching(/custom role/i),
      });
    }
  });

  it("returns 204 when deleting a custom role", async () => {
    mockState.selectQueue.push([MOCK_CUSTOM_ROLE]); // role found
    mockState.selectQueue.push([{ id: "role-member" }]); // Member fallback role

    const res = await request(buildApp()).delete("/api/roles/role-custom");

    expect(res.status).toBe(204);
    expect(mockState.updateCalls).toBe(1); // members were reassigned
    expect(mockState.deleteCalls).toBe(1); // role was deleted
  });
});
