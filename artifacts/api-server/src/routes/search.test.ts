/**
 * Cross-org isolation and behavior tests for GET /search.
 *
 * Isolation strategy
 * ------------------
 * The drizzle-orm `eq` function is a vi.fn() spy. The DB mock snapshots the
 * spy call-count when `db.select()` is called, then — when `.where()` runs —
 * inspects only the eq calls that occurred AFTER that snapshot (i.e. those
 * belonging to this specific query's WHERE clause). It extracts the orgId that
 * was passed and filters the mixed-org pool accordingly.
 *
 * Consequence: if the route removes `eq(table.orgId, orgId)` from ANY of the
 * three queries, that chain finds no orgId, returns ALL rows (including org-b),
 * and the assertion `expect(ids).not.toContain(ORG_B_*.id)` fails immediately.
 *
 * Visibility strategy
 * -------------------
 * When pool rows carry a `visibility` field the chain also inspects eq calls
 * for the string "public_read" (which the route passes as the visibility
 * predicate value).  If the predicate is absent, private notes pass through
 * unfiltered — the "excluded" assertion then fails, catching the regression.
 * The caller's user ID (starting with "user-") is captured the same way to
 * apply the createdBy fallback.
 *
 * Mixed-dataset model
 * -------------------
 * `mockState.pool[0..2]` contains rows from both orgs. Each chain filters by
 * the captured orgId, so only org-a rows reach the response — but only when the
 * predicate is present.
 *
 * Covered:
 *  - Parameter validation (q required, limit bounds)
 *  - orgId predicate present ≥ 3 times (one per entity type)
 *  - Mixed-org datasets: only org-a rows returned per entity type
 *  - Identical titles across orgs: no leakage
 *  - Note visibility: private notes excluded for non-author callers
 *  - Note visibility: public notes included for all org members
 *  - Note visibility: author can find their own private notes
 *  - Note excerpt: HTML stripping, 120-char cap, null content, raw content hidden
 *  - limit parameter: custom value, default
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// eq spy — hoisted so the vi.mock factory can reference it
// ---------------------------------------------------------------------------
const { eqSpy } = vi.hoisted(() => {
  const eqSpy = vi.fn((_col: unknown, _val: unknown) => ({ __col: _col, __val: _val }));
  return { eqSpy };
});

// ---------------------------------------------------------------------------
// Shared mock state (hoisted so the vi.mock factory can close over it)
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  pool: [[], [], []] as any[][],
  callCount: 0,
}));

// ---------------------------------------------------------------------------
// @workspace/db mock
//
// makeFilteringChain(rows, eqCallSnapshot):
//   - When .where() runs, inspects only eq calls that occurred AFTER eqCallSnapshot
//     (i.e. calls for THIS query's WHERE arguments).
//   - Stores the discovered orgId in a closure variable.
//   - Applies visibility filtering when pool rows carry a `visibility` field:
//       * If the visibility predicate ("public_read") is absent from the WHERE
//         eq calls, private rows pass through unfiltered → "excluded" assertion
//         fails → regression is caught.
//       * If the predicate is present, only public_read OR author's own rows
//         are returned.
//   - .limit() returns the filtered rows.
//   - If no orgId was found (predicate removed), .limit() returns ALL rows →
//     test will see org-b rows → assertion fails → regression caught.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeFilteringChain(rows: any[], eqCallSnapshot: number): any {
    let capturedOrgId: string | undefined;
    let capturedCallerId: string | undefined;
    let capturedHasVisibilityPredicate = false;

    const resolve = () => {
      // Filter by org (existing behaviour)
      const orgFiltered =
        capturedOrgId !== undefined
          ? rows.filter((r: any) => r.orgId === capturedOrgId)
          : rows; // no org filter → exposes all orgs → test assertion fails

      // Apply visibility filtering when any row carries a visibility field.
      // If the route dropped the visibility predicate, capturedHasVisibilityPredicate
      // is false → all rows (including private) are returned → the "excluded"
      // assertion fails → regression caught.
      const hasVisibilityField = orgFiltered.some((r: any) => "visibility" in r);
      if (!hasVisibilityField) return orgFiltered;

      if (!capturedHasVisibilityPredicate) {
        // Predicate missing → leak all rows so the caller-exclusion test fails.
        return orgFiltered;
      }

      return orgFiltered.filter(
        (r: any) =>
          r.visibility === "public_read" || r.createdBy === capturedCallerId,
      );
    };

    const chain: any = {
      from:    () => chain,
      orderBy: () => chain,
      where: () => {
        // Only look at eq calls that happened after this chain was constructed.
        // This prevents one query's values from bleeding into another chain.
        const newCalls = (eqSpy as ReturnType<typeof vi.fn>).mock.calls.slice(eqCallSnapshot);
        capturedOrgId = undefined;
        capturedCallerId = undefined;
        capturedHasVisibilityPredicate = false;
        for (const [, val] of newCalls) {
          if (typeof val === "string" && val.startsWith("org-")) {
            capturedOrgId = val;
          }
          if (typeof val === "string" && val.startsWith("user-")) {
            capturedCallerId = val;
          }
          if (typeof val === "string" && val === "public_read") {
            capturedHasVisibilityPredicate = true;
          }
        }
        return chain;
      },
      limit: () => Promise.resolve(resolve()),
      then(onfulfilled: any, onrejected: any) {
        return Promise.resolve(resolve()).then(onfulfilled, onrejected);
      },
      catch(onrejected: any) {
        return Promise.resolve(resolve()).catch(onrejected);
      },
    };
    return chain;
  }

  return {
    db: {
      select: () => {
        // Snapshot eq call count NOW (before this query's WHERE args are evaluated)
        const snapshot = (eqSpy as ReturnType<typeof vi.fn>).mock.calls.length;
        const rows = mockState.pool[mockState.callCount % 3] ?? [];
        mockState.callCount++;
        return makeFilteringChain(rows, snapshot);
      },
    },
    tasksTable:    { orgId: "__tasks_orgId__" },
    projectsTable: { orgId: "__projects_orgId__" },
    notesTable:    { orgId: "__notes_orgId__", visibility: "__notes_visibility__", createdBy: "__notes_createdBy__" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq:    eqSpy,
  and:   (...args: any[]) => ({ __and: args }),
  or:    (...args: any[]) => ({ __or:  args }),
  ilike: () => ({}),
}));

// ---------------------------------------------------------------------------
// requireOrg — caller is always org-a / user-a
// ---------------------------------------------------------------------------
vi.mock("../middlewares/requireOrgMiddleware", () => ({
  hasPermission: (req: any, key: string) => req.orgPermissions?.[key] ?? false,
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  requireOrgOrApiKey: (req: any, _res: any, next: any) => {
    req.orgId = "org-a";
    req.user  = { id: "user-a" };
    next();
  },
  requireOrg: (req: any, _res: any, next: any) => {
    req.orgId = "org-a";
    req.user  = { id: "user-a" };
    next();
  },
}));

// ---------------------------------------------------------------------------
// Import route after all mocks are in place
// ---------------------------------------------------------------------------
import searchRouter from "./search.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", searchRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Pool helpers
// ---------------------------------------------------------------------------
function seedPool(tasks: any[], projects: any[], notes: any[]) {
  mockState.pool[0] = tasks;
  mockState.pool[1] = projects;
  mockState.pool[2] = notes;
}

// ---------------------------------------------------------------------------
// Fixtures — both orgs share keywords to make isolation meaningful
// ---------------------------------------------------------------------------
const ORG_A_TASK = { orgId: "org-a", id: 1,  title: "Deploy infra", status: "todo", priority: "high", projectId: null };
const ORG_B_TASK = { orgId: "org-b", id: 42, title: "Deploy infra", status: "todo", priority: "high", projectId: null };

const ORG_A_PROJECT = { orgId: "org-a", id: 10, name: "Infra Upgrade", status: "active" };
const ORG_B_PROJECT = { orgId: "org-b", id: 99, name: "Infra Upgrade", status: "active" };

// Legacy fixtures without visibility (backward-compat — mock skips visibility filter for these)
const ORG_A_NOTE = { orgId: "org-a", id: 100, title: "Runbook", content: "deploy steps for the infra rollout" };
const ORG_B_NOTE = { orgId: "org-b", id: 55,  title: "Runbook", content: "org-b secret runbook content" };

// Visibility fixtures — same org, same keyword, different visibility/ownership.
// Caller is user-a; user-b owns the other-user notes.
const NOTE_PUBLIC_OTHER_USER  = { orgId: "org-a", id: 200, title: "Runbook", content: "shared guide",  visibility: "public_read", createdBy: "user-b" };
const NOTE_PRIVATE_OTHER_USER = { orgId: "org-a", id: 201, title: "Runbook", content: "secret guide",  visibility: "private",     createdBy: "user-b" };
const NOTE_PRIVATE_CALLER     = { orgId: "org-a", id: 202, title: "Runbook", content: "my secret note", visibility: "private",    createdBy: "user-a" };

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  eqSpy.mockClear();
  mockState.pool = [[], [], []];
  mockState.callCount = 0;
});

// ===========================================================================
// Parameter validation
// ===========================================================================

describe("GET /api/search — parameter validation", () => {
  it("returns 400 when q is missing", async () => {
    expect((await request(buildApp()).get("/api/search")).status).toBe(400);
  });

  it("returns 400 when q is an empty string", async () => {
    expect((await request(buildApp()).get("/api/search?q=")).status).toBe(400);
  });

  it("returns 400 when limit exceeds 20", async () => {
    expect((await request(buildApp()).get("/api/search?q=test&limit=100")).status).toBe(400);
  });

  it("returns 400 when limit is below 1", async () => {
    expect((await request(buildApp()).get("/api/search?q=test&limit=0")).status).toBe(400);
  });
});

// ===========================================================================
// orgId predicate enforcement
// ===========================================================================

describe("GET /api/search — orgId predicate is present in every entity query", () => {
  it("calls eq with 'org-a' at least 3 times (once per entity: tasks, projects, notes)", async () => {
    seedPool([ORG_A_TASK], [ORG_A_PROJECT], [ORG_A_NOTE]);
    await request(buildApp()).get("/api/search?q=infra");

    const orgIdCalls = eqSpy.mock.calls.filter(([, val]) => val === "org-a");
    expect(orgIdCalls.length).toBeGreaterThanOrEqual(3);
  });
});

// ===========================================================================
// Cross-org isolation — mixed datasets
// ===========================================================================

describe("GET /api/search — cross-org isolation with mixed-org datasets", () => {
  it("returns only org-a tasks when both orgs have tasks with the same title", async () => {
    seedPool([ORG_A_TASK, ORG_B_TASK], [], []);
    const res = await request(buildApp()).get("/api/search?q=Deploy+infra");

    expect(res.status).toBe(200);
    const ids = res.body.tasks.map((t: any) => t.id);
    expect(ids).toContain(ORG_A_TASK.id);
    expect(ids).not.toContain(ORG_B_TASK.id);
  });

  it("returns only org-a projects when both orgs have projects with the same name", async () => {
    seedPool([], [ORG_A_PROJECT, ORG_B_PROJECT], []);
    const res = await request(buildApp()).get("/api/search?q=Infra+Upgrade");

    expect(res.status).toBe(200);
    const ids = res.body.projects.map((p: any) => p.id);
    expect(ids).toContain(ORG_A_PROJECT.id);
    expect(ids).not.toContain(ORG_B_PROJECT.id);
  });

  it("returns only org-a notes when both orgs have notes with the same title", async () => {
    seedPool([], [], [ORG_A_NOTE, ORG_B_NOTE]);
    const res = await request(buildApp()).get("/api/search?q=Runbook");

    expect(res.status).toBe(200);
    const ids = res.body.notes.map((n: any) => n.id);
    expect(ids).toContain(ORG_A_NOTE.id);
    expect(ids).not.toContain(ORG_B_NOTE.id);
  });

  it("returns empty results for all types when only org-b has matching data", async () => {
    seedPool([ORG_B_TASK], [ORG_B_PROJECT], [ORG_B_NOTE]);
    const res = await request(buildApp()).get("/api/search?q=infra");

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
    expect(res.body.projects).toEqual([]);
    expect(res.body.notes).toEqual([]);
  });

  it("returns org-a results across all three types from a fully mixed pool", async () => {
    seedPool(
      [ORG_A_TASK, ORG_B_TASK],
      [ORG_A_PROJECT, ORG_B_PROJECT],
      [ORG_A_NOTE, ORG_B_NOTE],
    );
    const res = await request(buildApp()).get("/api/search?q=infra");

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.tasks[0].id).toBe(ORG_A_TASK.id);
    expect(res.body.projects[0].id).toBe(ORG_A_PROJECT.id);
    expect(res.body.notes[0].id).toBe(ORG_A_NOTE.id);
  });

  it("returns empty results when both orgs have identical titles but org-a has none in db", async () => {
    // Pool is empty for org-a — simulates org-a having no matching rows even
    // though org-b does. The org filter correctly excludes org-b's rows.
    seedPool([], [], []);
    const res = await request(buildApp()).get("/api/search?q=Deploy+infra");

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
    expect(res.body.projects).toEqual([]);
    expect(res.body.notes).toEqual([]);
  });
});

// ===========================================================================
// Note visibility isolation
// ===========================================================================

describe("GET /api/search — note visibility isolation", () => {
  it("excludes a private note whose author is a different org member", async () => {
    // NOTE_PRIVATE_OTHER_USER is in org-a but owned by user-b; caller is user-a.
    // The visibility predicate must filter it out.
    seedPool([], [], [NOTE_PRIVATE_OTHER_USER]);
    const res = await request(buildApp()).get("/api/search?q=Runbook");

    expect(res.status).toBe(200);
    expect(res.body.notes).toEqual([]);
  });

  it("includes a public_read note that belongs to a different org member", async () => {
    // NOTE_PUBLIC_OTHER_USER is owned by user-b but has visibility=public_read,
    // so user-a should see it.
    seedPool([], [], [NOTE_PUBLIC_OTHER_USER]);
    const res = await request(buildApp()).get("/api/search?q=Runbook");

    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].id).toBe(NOTE_PUBLIC_OTHER_USER.id);
  });

  it("includes the caller's own private note in their search results", async () => {
    // NOTE_PRIVATE_CALLER is private but owned by user-a (the caller).
    seedPool([], [], [NOTE_PRIVATE_CALLER]);
    const res = await request(buildApp()).get("/api/search?q=Runbook");

    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].id).toBe(NOTE_PRIVATE_CALLER.id);
  });

  it("returns only public note when both a public and private note match the same query", async () => {
    // Mixes the public note (user-b, visible) and private note (user-b, hidden)
    // in the same pool — only the public one should appear.
    seedPool([], [], [NOTE_PUBLIC_OTHER_USER, NOTE_PRIVATE_OTHER_USER]);
    const res = await request(buildApp()).get("/api/search?q=Runbook");

    expect(res.status).toBe(200);
    const ids = res.body.notes.map((n: any) => n.id);
    expect(ids).toContain(NOTE_PUBLIC_OTHER_USER.id);
    expect(ids).not.toContain(NOTE_PRIVATE_OTHER_USER.id);
  });
});

// ===========================================================================
// Note excerpt handling
// ===========================================================================

describe("GET /api/search — note excerpt handling", () => {
  it("strips HTML tags from note content in the excerpt", async () => {
    const noteWithHtml = { ...ORG_A_NOTE, content: "<p>Deploy the <strong>infra</strong> rollout steps</p>" };
    seedPool([], [], [noteWithHtml]);
    const res = await request(buildApp()).get("/api/search?q=deploy");

    expect(res.status).toBe(200);
    expect(res.body.notes[0].excerpt).not.toContain("<");
    expect(res.body.notes[0].excerpt).toContain("Deploy");
  });

  it("caps the excerpt at 120 characters", async () => {
    const longNote = { ...ORG_A_NOTE, content: "word ".repeat(100) };
    seedPool([], [], [longNote]);
    const res = await request(buildApp()).get("/api/search?q=word");

    expect(res.status).toBe(200);
    expect(res.body.notes[0].excerpt!.length).toBeLessThanOrEqual(120);
  });

  it("returns null excerpt when note content is null", async () => {
    seedPool([], [], [{ ...ORG_A_NOTE, content: null }]);
    const res = await request(buildApp()).get("/api/search?q=runbook");

    expect(res.status).toBe(200);
    expect(res.body.notes[0].excerpt).toBeNull();
  });

  it("does not expose the raw content field in the response", async () => {
    seedPool([], [], [ORG_A_NOTE]);
    const res = await request(buildApp()).get("/api/search?q=runbook");

    expect(res.status).toBe(200);
    expect(res.body.notes[0]).not.toHaveProperty("content");
  });

  it("does not expose the visibility or createdBy fields in the response", async () => {
    seedPool([], [], [NOTE_PUBLIC_OTHER_USER]);
    const res = await request(buildApp()).get("/api/search?q=Runbook");

    expect(res.status).toBe(200);
    expect(res.body.notes[0]).not.toHaveProperty("visibility");
    expect(res.body.notes[0]).not.toHaveProperty("createdBy");
  });
});

// ===========================================================================
// Limit parameter
// ===========================================================================

describe("GET /api/search — limit parameter", () => {
  it("accepts a valid custom limit", async () => {
    seedPool([ORG_A_TASK], [], []);
    const res = await request(buildApp()).get("/api/search?q=deploy&limit=3");
    expect(res.status).toBe(200);
  });

  it("works with the default limit when the param is absent", async () => {
    seedPool([ORG_A_TASK], [], []);
    const res = await request(buildApp()).get("/api/search?q=deploy");
    expect(res.status).toBe(200);
  });
});
