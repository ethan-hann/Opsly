/**
 * Waits for the API server to be ready before the frontend dev server starts.
 * Polls GET <API_INTERNAL_URL>/api/healthz until it returns 200.
 *
 * API_INTERNAL_URL defaults to http://localhost:8080 for native dev.
 * Docker Compose sets it to http://api:8080 so the web container can reach
 * the api container over the Docker network (localhost doesn't cross containers).
 */

const base = (process.env.API_INTERNAL_URL ?? "http://localhost:8080").replace(/\/$/, "");
const API_URL = `${base}/api/healthz`;
const POLL_MS = 500;
const TIMEOUT_MS = 60_000;

const start = Date.now();
process.stdout.write("Waiting for API server");

while (true) {
  try {
    const res = await fetch(API_URL);
    if (res.ok) {
      process.stdout.write(" ready.\n");
      process.exit(0);
    }
  } catch {
    // not up yet
  }

  if (Date.now() - start > TIMEOUT_MS) {
    process.stderr.write("\nTimed out waiting for API server.\n");
    process.exit(1);
  }

  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, POLL_MS));
}
