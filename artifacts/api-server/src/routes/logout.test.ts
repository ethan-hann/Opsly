/**
 * Logout must be a POST so it is not forgeable via a cross-site navigation
 * (a SameSite=Lax cookie would still ride a top-level GET). These assert the
 * method contract and that the redirect target is correct in both auth modes.
 *
 * All external dependencies are mocked so this runs without a DB or OIDC provider.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const mockState = vi.hoisted(() => ({
  oidc: false,
  clearedSid: undefined as string | undefined,
}));

vi.mock("@workspace/api-zod", () => ({
  ExchangeMobileAuthorizationCodeBody: { safeParse: () => ({ success: false }) },
  ExchangeMobileAuthorizationCodeResponse: { parse: (v: any) => v },
  GetCurrentAuthUserResponse: { parse: (v: any) => v },
  LogoutMobileSessionResponse: { parse: (v: any) => v },
}));

vi.mock("@workspace/db", () => ({
  db: {},
  usersTable: {},
  invitationsTable: {},
  passwordResetsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
}));

vi.mock("../lib/auth", () => ({
  getAuthMode: () => (mockState.oidc ? "oidc" : "local"),
  getAuthConfig: () => ({ mode: mockState.oidc ? "oidc" : "local" }),
  getOidcConfig: async () => ({}),
  getOidcAuthConfig: () => ({
    clientId: "client-x",
    issuerUrl: "https://idp.example",
  }),
  isOidcAuthMode: (mode: string) => mode === "oidc",
  createSession: async () => "test-session-id",
  deleteSession: async () => {},
  clearSession: async (_res: unknown, sid: string | undefined) => {
    mockState.clearedSid = sid;
  },
  getSessionId: () => "resolved-sid",
  SESSION_COOKIE: "sid",
  SESSION_TTL: 604800000,
}));

vi.mock("../lib/local-password", () => ({
  hashLocalPassword: async () => "hash",
  verifyLocalPassword: async () => true,
}));

vi.mock("../lib/email", () => ({
  sendMail: async () => ({ ok: true }),
  buildPasswordResetEmail: () => "<html></html>",
}));

vi.mock("openid-client", () => ({
  randomState: () => "state",
  randomNonce: () => "nonce",
  randomPKCECodeVerifier: () => "verifier",
  calculatePKCECodeChallenge: async () => "challenge",
  buildAuthorizationUrl: () => ({ href: "https://idp.example/auth" }),
  authorizationCodeGrant: async () => ({}),
  buildEndSessionUrl: () => ({ href: "https://idp.example/logout" }),
}));

import authRouter from "./auth.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", authRouter);
  return app;
}

describe("POST /api/logout", () => {
  beforeEach(() => {
    mockState.oidc = false;
    mockState.clearedSid = undefined;
  });

  it("clears the session and redirects to a safe returnTo in local mode", async () => {
    const res = await request(buildApp()).post("/api/logout?returnTo=/dashboard");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/dashboard");
    expect(mockState.clearedSid).toBe("resolved-sid");
  });

  it("redirects to the OIDC end-session URL in oidc mode", async () => {
    mockState.oidc = true;
    const res = await request(buildApp()).post("/api/logout");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://idp.example/logout");
  });

  it("rejects an unsafe (absolute) returnTo, falling back to /", async () => {
    const res = await request(buildApp()).post(
      "/api/logout?returnTo=https://evil.example",
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
  });
});

describe("GET /api/logout", () => {
  it("is not registered — a state-changing GET must not exist (CSRF)", async () => {
    const res = await request(buildApp()).get("/api/logout");
    expect(res.status).toBe(404);
  });
});
