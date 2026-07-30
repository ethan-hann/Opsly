import type cors from "cors";

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function buildAllowedOrigins(): string[] {
  const origins = new Set<string>();
  const appUrl = process.env["APP_URL"];
  if (appUrl) origins.add(appUrl.replace(/\/$/, ""));
  for (const entry of (process.env["CORS_ALLOWED_ORIGINS"] ?? "").split(",")) {
    const trimmed = entry.trim().replace(/\/$/, "");
    if (trimmed) origins.add(trimmed);
  }
  return [...origins];
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
  isDev: boolean,
): boolean {
  // Same-origin requests, native mobile apps, and server-to-server calls send no
  // Origin header — CORS only governs browser cross-origin requests.
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // In dev the Vite frontend and API run on different localhost ports.
  return isDev && LOCALHOST_ORIGIN.test(origin);
}

export function buildCorsOptions(): cors.CorsOptions {
  const allowedOrigins = buildAllowedOrigins();
  const isDev = process.env["NODE_ENV"] !== "production";
  return {
    credentials: true,
    origin(origin, callback) {
      // Passing `false` (not an Error) omits the CORS headers so the browser
      // blocks the response, without reflecting an untrusted origin back with
      // credentials or turning the request into a 500.
      callback(null, isOriginAllowed(origin, allowedOrigins, isDev));
    },
  };
}
