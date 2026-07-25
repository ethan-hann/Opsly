# #510 — Confirm the production image starts and applies the DB schema with only production deps installed

**State:** PROPOSED
**Depends on:** #498

---

# Confirm the production image starts and applies the DB schema with only production deps installed

## What & Why

Task #498 switched the runner stage from copying the full node_modules to running `pnpm install --prod --frozen-lockfile`. There is no automated test that proves the resulting image can actually boot — run `pnpm --filter @workspace/db run push` (which needs drizzle-kit) and then start the API server — with only production dependencies present.

## Done looks like

- A CI-style smoke test (or documented manual steps) builds the production image and runs the startup command against a real Postgres instance
- The drizzle schema push completes without "command not found" or missing-module errors
- The API server starts and `GET /api/healthz` returns 200

## Relevant files

- `Dockerfile` (runner stage, CMD)
- `lib/db/package.json` (drizzle-kit now in dependencies)
- `artifacts/api-server/SELF_HOSTING.md` (smoke-test instructions)
