/**
 * Waits for the API server to be ready before the frontend dev server starts.
 * Polls GET http://localhost:8080/api/healthz until it returns 200.
 */

const API_URL = "http://localhost:8080/api/healthz";
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
