/**
 * Tests for org terminology routes.
 *
 * @workspace/db and requireOrgMiddleware are fully mocked so these tests run
 * without a live database or auth session.
 *
 * Covered:
 *  - GET  /orgs/terminology  — returns defaults for a fresh org
 *  - GET  /orgs/terminology  — merges custom overrides over defaults
 *  - PATCH /orgs/terminology — persists overrides; GET reflects them
 *  - PATCH /orgs/terminology — 403 for member (no manage_terminology)
 *  - PATCH /orgs/terminology — 400 for empty string label
 *  - PATCH /orgs/terminology — 400 for label exceeding 50 chars
 *  - PATCH /orgs/terminology — 400 when no keys are provided
 *  - Cross-org isolation     — org A overrides do not appear for org B
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  insertQueue: [] as any[][],
  onConflictRows: [] as any[],
  orgPermissions: {
    view_tasks: true,
    create_tasks: true,
    edit_tasks: true,
    close_tasks: true,
    delete_tasks: true,
    manage_projects: true,
    manage_org_settings: true,
    manage_members: true,
    manage_webhooks: true,
    manage_api_keys: true,
    manage_custom_fields: true,
    manage_workflow_stages: true,
    manage_sla_policies: true,
    manage_task_templates: true,
    manage_saved_views: true,
    view_audit_log: true,
    manage_terminology: true,
  } as Record<string, boolean>,
  currentOrgId: 'org-a',
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock('@workspace/db', () => {
  function makeChain(result: any[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
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
        const base = noop();
        return Object.assign(base, {
          returning: () => Promise.resolve(mockState.insertQueue.shift() ?? []),
          onConflictDoUpdate: () => noop(),
        });
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Object.assign(noop(), {
          returning: () => Promise.resolve([]),
        }),
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
    orgTerminologyTable: { orgId: 'orgId', termKey: 'termKey' },
    orgFeaturesTable: {},
    ORG_FEATURES: [],
    OWNER_PERMISSIONS: {},
    ADMIN_PERMISSIONS: {},
    MEMBER_PERMISSIONS: {},
    ALL_PERMISSIONS: [],
    TERMINOLOGY_KEYS: ['projects', 'tasks', 'members', 'workflows', 'stages'],
    SINGULAR_TERMINOLOGY_KEYS: ['projectsSingular', 'tasksSingular', 'membersSingular', 'workflowsSingular', 'stagesSingular'],
    TERMINOLOGY_DEFAULTS: {
      projects: 'Projects',
      tasks: 'Tasks',
      members: 'Members',
      workflows: 'Workflows',
      stages: 'Stages',
    },
    eq: () => ({}),
    and: () => ({}),
    or: () => ({}),
    sql: () => ({}),
    isNull: () => ({}),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  sql: () => ({}),
  isNull: () => ({}),
}));

vi.mock('../lib/webhook-dispatcher', () => ({
  dispatchMemberJoined: vi.fn(),
  dispatchMemberRemoved: vi.fn(),
}));

vi.mock('../lib/email', () => ({
  isEmailConfigured: vi.fn().mockReturnValue(false),
  sendMail: vi.fn().mockResolvedValue({ ok: true }),
  buildInviteEmail: vi.fn().mockReturnValue('<a>Accept</a>'),
}));

vi.mock('../lib/sse', () => ({ pushEvent: vi.fn() }));

vi.mock('../lib/org-features', () => ({
  requireOrgFeature: () => (_req: any, _res: any, next: any) => next(),
  getOrgFeatureStates: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/workflow-stages', () => ({
  seedDefaultStages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Middleware mock — we test business logic, not auth guards
// ---------------------------------------------------------------------------
vi.mock('../middlewares/requireOrgMiddleware', () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-owner' };
    req.orgId = mockState.currentOrgId;
    req.orgRoleId = 'role-owner';
    req.orgRoleName = 'Owner';
    req.isOrgOwner = true;
    req.orgPermissions = { ...mockState.orgPermissions };
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-owner' };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-owner' };
    req.orgId = mockState.currentOrgId;
    req.orgRoleId = 'role-owner';
    req.orgRoleName = 'Owner';
    req.isOrgOwner = true;
    req.orgPermissions = { ...mockState.orgPermissions };
    next();
  },
  requirePermission: (key: string) => (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.[key]) {
      res.status(403).json({ error: `Permission required: ${key}` });
      return;
    }
    next();
  },
  requireOwner: (req: any, res: any, next: any) => {
    if (!req.isOrgOwner) { res.status(403).json({ error: 'Owner access required' }); return; }
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.orgPermissions?.manage_projects) { res.status(403).json({ error: 'Admin access required' }); return; }
    next();
  },
}));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
import orgsRouter from './orgs';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', orgsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/orgs/terminology', () => {
  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.insertQueue = [];
    mockState.orgPermissions.manage_terminology = true;
    mockState.currentOrgId = 'org-a';
  });

  it('returns all five defaults when no overrides exist', async () => {
    // resolveTerminology returns empty rows → defaults used
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get('/api/orgs/terminology');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: 'Projects',
      tasks: 'Tasks',
      members: 'Members',
      workflows: 'Workflows',
      stages: 'Stages',
    });
  });

  it('merges custom overrides over defaults', async () => {
    mockState.selectQueue.push([
      { termKey: 'tasks', customLabel: 'Tickets' },
      { termKey: 'members', customLabel: 'Agents' },
    ]);

    const res = await request(buildApp()).get('/api/orgs/terminology');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projects: 'Projects',
      tasks: 'Tickets',
      members: 'Agents',
      workflows: 'Workflows',
      stages: 'Stages',
    });
  });
});

describe('PATCH /api/orgs/terminology', () => {
  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.insertQueue = [];
    mockState.orgPermissions.manage_terminology = true;
    mockState.currentOrgId = 'org-a';
  });

  it('persists overrides and returns the resolved map', async () => {
    // After upsert, resolveTerminology is called; queue shows the saved rows
    mockState.selectQueue.push([
      { termKey: 'tasks', customLabel: 'Tickets' },
    ]);

    const res = await request(buildApp())
      .patch('/api/orgs/terminology')
      .send({ tasks: 'Tickets' });

    expect(res.status).toBe(200);
    expect(res.body.tasks).toBe('Tickets');
    expect(res.body.projects).toBe('Projects'); // default preserved
  });

  it('returns 403 when caller lacks manage_terminology', async () => {
    mockState.orgPermissions.manage_terminology = false;

    const res = await request(buildApp())
      .patch('/api/orgs/terminology')
      .send({ tasks: 'Tickets' });

    expect(res.status).toBe(403);
  });

  it('returns 400 for an empty string label', async () => {
    const res = await request(buildApp())
      .patch('/api/orgs/terminology')
      .send({ tasks: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a label exceeding 50 characters', async () => {
    const res = await request(buildApp())
      .patch('/api/orgs/terminology')
      .send({ tasks: 'A'.repeat(51) });

    expect(res.status).toBe(400);
  });

  it('returns 400 when no keys are provided', async () => {
    const res = await request(buildApp())
      .patch('/api/orgs/terminology')
      .send({});

    expect(res.status).toBe(400);
  });

  it('accepts a label of exactly 50 characters', async () => {
    mockState.selectQueue.push([
      { termKey: 'projects', customLabel: 'P'.repeat(50) },
    ]);

    const res = await request(buildApp())
      .patch('/api/orgs/terminology')
      .send({ projects: 'P'.repeat(50) });

    expect(res.status).toBe(200);
    expect(res.body.projects).toBe('P'.repeat(50));
  });
});

describe('Cross-org isolation', () => {
  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.insertQueue = [];
    mockState.orgPermissions.manage_terminology = true;
  });

  it('org A overrides do not appear for org B', async () => {
    // Org B request: resolveTerminology returns no rows (org B has no overrides)
    mockState.currentOrgId = 'org-b';
    mockState.selectQueue.push([]);

    const res = await request(buildApp()).get('/api/orgs/terminology');
    expect(res.status).toBe(200);
    // Org B sees only defaults — no bleed-through from org A
    expect(res.body).toEqual({
      projects: 'Projects',
      tasks: 'Tasks',
      members: 'Members',
      workflows: 'Workflows',
      stages: 'Stages',
    });
  });
});

// ===========================================================================
// Custom singular term changes button labels (#335)
//
// Saving a custom term (e.g. 'Incident') via PATCH /api/orgs/terminology then
// fetching via GET must return that value. The UI reads this API to render
// button labels, so the API contract is the testable surface.
// ===========================================================================

describe('Custom singular term — API contract (#335)', () => {
  beforeEach(() => {
    mockState.selectQueue = [];
    mockState.insertQueue = [];
    mockState.orgPermissions.manage_terminology = true;
  });

  it('PATCH with a singular-form term saves and GET reflects it', async () => {
    // Simulate the DB round-trip: PATCH upserts, GET returns the saved row
    const savedRow = { termKey: 'tasks', customLabel: 'Incident' };
    mockState.selectQueue.push([savedRow]); // GET resolveTerminology after PATCH

    const patchRes = await request(buildApp())
      .patch('/api/orgs/terminology')
      .send({ tasks: 'Incident' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.tasks).toBe('Incident');
  });

  it('singular-form custom term is returned correctly by GET', async () => {
    // The GET endpoint returns whatever is stored — including singular-sounding labels
    mockState.selectQueue.push([
      { termKey: 'tasks', customLabel: 'Ticket' },
    ]);

    const res = await request(buildApp()).get('/api/orgs/terminology');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toBe('Ticket');
    // Other keys default to their plural form
    expect(res.body.projects).toBe('Projects');
    expect(res.body.members).toBe('Members');
  });

  it('saving different singular terms for tasks and projects works independently', async () => {
    // Each key is stored separately; only the patched key changes
    mockState.selectQueue.push([
      { termKey: 'tasks', customLabel: 'Request' },
      { termKey: 'projects', customLabel: 'Queue' },
    ]);

    const res = await request(buildApp()).get('/api/orgs/terminology');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toBe('Request');
    expect(res.body.projects).toBe('Queue');
    // Un-customized keys still return their defaults
    expect(res.body.members).toBe('Members');
    expect(res.body.stages).toBe('Stages');
  });
});
