/**
 * Boot smoke check for the api-server.
 *
 * Precondition: the api-server must already be built. Run `pnpm --filter
 * @workspace/api-server run build` before invoking this script, or use:
 *   pnpm --filter @workspace/api-server run build && \
 *   pnpm --filter @workspace/api-server run smoke
 *
 * No Postgres or storage environment variables are required: /api/healthz
 * returns 200 with a static payload and does not depend on DB availability.
 *
 * Usage (from repo root): pnpm --filter @workspace/api-server run smoke
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SMOKE_PORT = 8080;
const HEALTH_URL = `http://localhost:${SMOKE_PORT}/api/healthz`;
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 2_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.resolve(__dirname, "../dist/index.mjs");

if (!existsSync(entryPoint)) {
  console.error(
    `[smoke] ERROR: Built entry point not found: ${entryPoint}\n` +
      `[smoke] Run \`pnpm --filter @workspace/api-server run build\` first.`,
  );
  process.exit(1);
}

/** Collected output from the child process for diagnostics on failure. */
const childOutput = [];

const child = spawn("node", ["--enable-source-maps", entryPoint], {
  cwd: path.resolve(__dirname, ".."),
  env: {
    ...process.env,
    PORT: String(SMOKE_PORT),
    STORAGE_DRIVER: "local",
    // lib/db requires DATABASE_URL at module-load time, but boot smoke does
    // not need a reachable database because /api/healthz is static.
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/opsly_test",
    // Suppress pino's pretty-printing in smoke output for cleaner CI logs.
    NODE_ENV: "production",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => childOutput.push(chunk.toString()));
child.stderr.on("data", (chunk) => childOutput.push(chunk.toString()));

let childExited = false;
let childExitCode = null;

child.on("exit", (code) => {
  childExited = true;
  childExitCode = code;
});

/** Kill the child and drain any remaining output. */
function cleanup(killSignal = "SIGKILL") {
  if (!childExited) {
    try {
      child.kill(killSignal);
    } catch {
      // Already gone — ignore.
    }
  }
}

/** Poll /api/healthz until 200, timeout, or child exits early. */
async function pollHealthz() {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    // If the child died before responding, bail out immediately.
    if (childExited) {
      return { ok: false, reason: "child-exited" };
    }

    try {
      const remainingMs = deadline - Date.now();
      const res = await fetch(HEALTH_URL, {
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
      });
      if (res.status === 200) {
        return { ok: true };
      }
    } catch {
      // Connection refused or network error — server not ready yet.
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return { ok: false, reason: "timeout" };
}

const result = await pollHealthz();

if (result.ok) {
  console.log("[smoke] /api/healthz returned 200 — server started successfully.");
  // Ask the server to shut down gracefully.
  child.kill("SIGTERM");
  // Give the graceful shutdown a moment, then exit regardless.
  await new Promise((r) => setTimeout(r, 3_000));
  cleanup();
  process.exit(0);
} else {
  const reason =
    result.reason === "timeout"
      ? `Timed out after ${TIMEOUT_MS / 1000}s waiting for /api/healthz to return 200.`
      : `Server process exited with code ${childExitCode} before /api/healthz responded.`;

  console.error(`[smoke] FAILED — ${reason}`);
  console.error("[smoke] --- captured server output ---");
  console.error(childOutput.join(""));
  console.error("[smoke] --- end server output ---");
  cleanup();
  process.exit(1);
}
