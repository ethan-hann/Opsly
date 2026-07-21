/**
 * Tests for the one-click digest email unsubscribe route.
 *
 * GET /api/unsubscribe?token=<signed-jwt>
 *
 * @workspace/db is fully mocked so these run without a live database.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  upsertCalled: false,
  upsertValues: null as any,
  throwOnUpsert: false,
}));

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  function makeInsertChain(state: typeof mockState): any {
    const chain: any = {
      values: (vals: any) => {
        state.upsertValues = vals;
        return chain;
      },
      onConflictDoUpdate: () => {
        state.upsertCalled = true;
        if (state.throwOnUpsert) throw new Error("DB error");
        return Promise.resolve();
      },
    };
    return chain;
  }

  return {
    db: {
      insert: () => makeInsertChain(mockState),
    },
    emailDigestPreferencesTable: { userId: "user_id" },
    eq: () => ({}),
  };
});

// ---------------------------------------------------------------------------
// Import router after mocks
// ---------------------------------------------------------------------------
import unsubscribeRouter from "./unsubscribe.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", unsubscribeRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Token helpers (re-create locally so tests don't import the live token lib)
// ---------------------------------------------------------------------------
import { generateUnsubscribeToken } from "../lib/unsubscribe-token.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/unsubscribe", () => {
  const originalSecret = process.env["SESSION_SECRET"];

  beforeEach(() => {
    mockState.upsertCalled = false;
    mockState.upsertValues = null;
    mockState.throwOnUpsert = false;
    // Restore a test secret before each test
    process.env["SESSION_SECRET"] = "test-secret-for-unsubscribe-tests";
  });

  afterEach(() => {
    // Restore original value after each test
    if (originalSecret === undefined) {
      delete process.env["SESSION_SECRET"];
    } else {
      process.env["SESSION_SECRET"] = originalSecret;
    }
  });

  it("returns 503 when SESSION_SECRET is not set", async () => {
    delete process.env["SESSION_SECRET"];
    const res = await request(buildApp()).get("/api/unsubscribe?token=anything");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/SESSION_SECRET/i);
  });

  it("returns 503 when SESSION_SECRET is an empty string", async () => {
    process.env["SESSION_SECRET"] = "";
    const res = await request(buildApp()).get("/api/unsubscribe?token=anything");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/SESSION_SECRET/i);
  });

  it("returns 400 when token is missing", async () => {
    const res = await request(buildApp()).get("/api/unsubscribe");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/missing token/i);
  });

  it("returns 400 when token is malformed", async () => {
    const res = await request(buildApp()).get("/api/unsubscribe?token=notavalidtoken");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when token signature is tampered", async () => {
    const token = generateUnsubscribeToken("user-1");
    const parts = token.split(".");
    // Corrupt the signature
    const tampered = `${parts[0]}.${parts[1]}.invalidsignature`;
    const res = await request(buildApp()).get(
      `/api/unsubscribe?token=${encodeURIComponent(tampered)}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("sets frequency to none and returns ok:true for a valid token", async () => {
    const token = generateUnsubscribeToken("user-42");
    const res = await request(buildApp()).get(
      `/api/unsubscribe?token=${encodeURIComponent(token)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockState.upsertCalled).toBe(true);
    expect(mockState.upsertValues).toMatchObject({
      userId: "user-42",
      frequency: "none",
    });
  });

  it("returns 500 when the database throws", async () => {
    mockState.throwOnUpsert = true;
    const token = generateUnsubscribeToken("user-99");
    const res = await request(buildApp()).get(
      `/api/unsubscribe?token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});
