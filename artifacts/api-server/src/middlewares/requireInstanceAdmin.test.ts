/**
 * Tests for requireInstanceAdmin middleware.
 *
 * Two auth paths:
 *  1. Bearer token — compared constant-time against INSTANCE_ADMIN_TOKEN env var
 *  2. Session user — DB lookup confirms isInstanceAdmin = true
 *
 * Covered:
 *  - Correct Bearer token → 200 (next() reached)
 *  - Wrong Bearer token    → 403
 *  - Right-length wrong token (timing-safe path exercised) → 403
 *  - Bearer header present but INSTANCE_ADMIN_TOKEN env var not set
 *      → falls through to session path → 401 (no session user)
 *  - No Authorization header and no session → 401
 *  - Session user with isInstanceAdmin = false → 403
 *  - Session user with isInstanceAdmin = true  → 200 (next() reached)
 *  - instanceAdminActor is populated correctly for both paths
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  userRows: [] as { isInstanceAdmin: boolean }[],
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db — only the select chain used by requireInstanceAdmin
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockState.userRows),
        }),
      }),
    }),
  },
  usersTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

import { requireInstanceAdmin } from "./requireInstanceAdmin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TOKEN = "super-secret-admin-token";

/** Build a minimal Express app that mounts requireInstanceAdmin on GET /test. */
function buildApp(sessionUser?: { id: string; email?: string }) {
  const app = express();
  app.use(express.json());

  // Simulate session middleware: attach user if provided
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (sessionUser) (req as any).user = sessionUser;
    next();
  });

  app.get(
    "/test",
    requireInstanceAdmin as express.RequestHandler,
    (_req: Request, res: Response) => res.json({ ok: true }),
  );

  return app;
}

// ---------------------------------------------------------------------------
// PATH 1 — Bearer token
// ---------------------------------------------------------------------------

describe("requireInstanceAdmin — Bearer token path", () => {
  beforeEach(() => {
    process.env.INSTANCE_ADMIN_TOKEN = VALID_TOKEN;
    mockState.userRows = [];
  });

  afterEach(() => {
    delete process.env.INSTANCE_ADMIN_TOKEN;
  });

  it("returns 200 and calls next() when the correct token is supplied", async () => {
    const res = await request(buildApp())
      .get("/test")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 403 when the supplied token does not match", async () => {
    const res = await request(buildApp())
      .get("/test")
      .set("Authorization", "Bearer wrong-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid instance admin token/i);
  });

  it("returns 403 when the token has the correct length but wrong bytes (constant-time path)", async () => {
    // Same length as VALID_TOKEN but different content — exercises timingSafeEqual.
    const sameLength = "x".repeat(VALID_TOKEN.length);
    const res = await request(buildApp())
      .get("/test")
      .set("Authorization", `Bearer ${sameLength}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid instance admin token/i);
  });

  it("does NOT fall through to session auth when a bad Bearer token is provided", async () => {
    // Even if a session user is present, a wrong token must produce 403 — not 200.
    const res = await request(buildApp({ id: "user-1", email: "admin@example.com" }))
      .get("/test")
      .set("Authorization", "Bearer wrong-token");

    expect(res.status).toBe(403);
  });

  it("sets instanceAdminActor to a token hash prefix on success", async () => {
    let capturedActor: string | undefined;
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      next();
    });
    app.get(
      "/test",
      requireInstanceAdmin as express.RequestHandler,
      (req: Request, res: Response) => {
        capturedActor = (req as any).instanceAdminActor;
        res.json({ ok: true });
      },
    );

    await request(app)
      .get("/test")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(capturedActor).toMatch(/^token:[0-9a-f]{8}$/);
  });

  it("falls through to session path (→ 401) when INSTANCE_ADMIN_TOKEN is not set", async () => {
    delete process.env.INSTANCE_ADMIN_TOKEN;
    // No session user → 401, not a token rejection 403
    const res = await request(buildApp())
      .get("/test")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATH 2 — Session user
// ---------------------------------------------------------------------------

describe("requireInstanceAdmin — session user path", () => {
  beforeEach(() => {
    // Ensure no env token so the Bearer branch is skipped (no Authorization header
    // in these tests anyway, but belt-and-suspenders).
    delete process.env.INSTANCE_ADMIN_TOKEN;
    mockState.userRows = [];
  });

  it("returns 401 when there is no Authorization header and no session user", async () => {
    const res = await request(buildApp()).get("/test");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it("returns 403 when the session user does not have isInstanceAdmin = true", async () => {
    mockState.userRows = [{ isInstanceAdmin: false }];

    const res = await request(buildApp({ id: "user-1", email: "user@example.com" })).get("/test");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/instance admin access required/i);
  });

  it("returns 403 when the user row is not found in the database", async () => {
    mockState.userRows = []; // no row → userRow is undefined → not admin

    const res = await request(buildApp({ id: "ghost-user" })).get("/test");

    expect(res.status).toBe(403);
  });

  it("returns 200 and calls next() when the session user has isInstanceAdmin = true", async () => {
    mockState.userRows = [{ isInstanceAdmin: true }];

    const res = await request(buildApp({ id: "user-1", email: "admin@example.com" })).get("/test");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("sets instanceAdminActor to 'user:<email>' on session success", async () => {
    mockState.userRows = [{ isInstanceAdmin: true }];

    let capturedActor: string | undefined;
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = { id: "user-1", email: "admin@example.com" };
      next();
    });
    app.get(
      "/test",
      requireInstanceAdmin as express.RequestHandler,
      (req: Request, res: Response) => {
        capturedActor = (req as any).instanceAdminActor;
        res.json({ ok: true });
      },
    );

    await request(app).get("/test");

    expect(capturedActor).toBe("user:admin@example.com");
  });
});
