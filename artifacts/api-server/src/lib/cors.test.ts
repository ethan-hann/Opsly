import { describe, it, expect } from "vitest";
import { isOriginAllowed, buildCorsOptions } from "./cors";

describe("isOriginAllowed", () => {
  const allowed = ["https://app.opsly.example"];

  it("allows requests with no Origin header (same-origin / native / S2S)", () => {
    expect(isOriginAllowed(undefined, allowed, false)).toBe(true);
  });

  it("allows an origin on the allowlist", () => {
    expect(isOriginAllowed("https://app.opsly.example", allowed, false)).toBe(
      true,
    );
  });

  it("rejects an unknown origin in production", () => {
    expect(isOriginAllowed("https://evil.example", allowed, false)).toBe(false);
  });

  it("allows localhost origins only in development", () => {
    expect(isOriginAllowed("http://localhost:20999", allowed, true)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:5173", allowed, true)).toBe(true);
    expect(isOriginAllowed("http://localhost:20999", allowed, false)).toBe(
      false,
    );
  });

  it("does not treat a lookalike host as localhost", () => {
    expect(isOriginAllowed("http://localhost.evil.example", allowed, true)).toBe(
      false,
    );
  });
});

describe("buildCorsOptions", () => {
  function resolve(
    origin: string | undefined,
    env: Record<string, string | undefined>,
  ): boolean {
    const saved = {
      APP_URL: process.env["APP_URL"],
      CORS_ALLOWED_ORIGINS: process.env["CORS_ALLOWED_ORIGINS"],
      NODE_ENV: process.env["NODE_ENV"],
    };
    Object.assign(process.env, env);
    try {
      const opts = buildCorsOptions();
      let allowed = false;
      // origin is always the function form here; invoke its callback.
      (opts.origin as (o: string | undefined, cb: (e: null, a?: boolean) => void) => void)(
        origin,
        (_e, a) => {
          allowed = a ?? false;
        },
      );
      return allowed;
    } finally {
      Object.assign(process.env, saved);
    }
  }

  it("builds the allowlist from APP_URL (trailing slash trimmed)", () => {
    expect(
      resolve("https://app.opsly.example", {
        APP_URL: "https://app.opsly.example/",
        CORS_ALLOWED_ORIGINS: undefined,
        NODE_ENV: "production",
      }),
    ).toBe(true);
  });

  it("adds comma-separated CORS_ALLOWED_ORIGINS entries", () => {
    expect(
      resolve("https://portal.example", {
        APP_URL: undefined,
        CORS_ALLOWED_ORIGINS: "https://portal.example, https://admin.example",
        NODE_ENV: "production",
      }),
    ).toBe(true);
  });

  it("rejects an origin outside the allowlist", () => {
    expect(
      resolve("https://evil.example", {
        APP_URL: "https://app.opsly.example",
        CORS_ALLOWED_ORIGINS: undefined,
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });
});
