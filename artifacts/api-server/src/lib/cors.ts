import type cors from "cors";

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// A browser Origin header is scheme+host+port with no path, so entries are
// normalized to URL.origin — this tolerates env values that carry a trailing
// slash or a path (e.g. https://app.example/opsly) instead of silently never
// matching. Unparseable entries are dropped.
function buildAllowedOrigins(): string[] {
  const origins = new Set<string>();
  const raw = [
    process.env["APP_URL"],
    ...(process.env["CORS_ALLOWED_ORIGINS"] ?? "").split(","),
  ];
  for (const entry of raw) {
    const trimmed = entry?.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Not a valid absolute URL — skip rather than add an unmatchable entry.
    }
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
  // Only true development, not merely "not production" — staging/test must not
  // implicitly allow localhost CORS. The dev script sets NODE_ENV=development.
  const isDev = process.env["NODE_ENV"] === "development";
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
