# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## First-time setup

A fresh instance has no instance administrator configured. Before regular
users can access admin-only endpoints you must set up at least **one** of
the following two paths:

### Path 1 — Static bearer token (recommended for automated / CI access)

Set the `INSTANCE_ADMIN_TOKEN` environment variable to a long random secret.
Any HTTP request that supplies `Authorization: Bearer <token>` with that
value is treated as an instance administrator. No user account is required.

```
# Generate a token (example):
openssl rand -hex 32

# Then set it as an environment variable in your deployment / .env file:
INSTANCE_ADMIN_TOKEN=<your-token>
```

### Path 2 — Promote an existing user account

Once a user has registered, run the `make-admin` script to grant them
instance-admin privileges:

```
DATABASE_URL=<your-db-url> pnpm --filter @workspace/db make-admin <email>
```

To revoke the privilege later:

```
DATABASE_URL=<your-db-url> pnpm --filter @workspace/db revoke-admin <email>
```

> **Startup warning:** If neither path is configured when the API server
> starts, it logs a `WARN` message reminding you to set one up.

---

## Run & Operate

- For full local setup and run instructions, see `LOCAL_DEV.md`.
- For containerized local setup (web + API + Postgres), use `docker-compose.local.yml` (see `LOCAL_DEV.md`).
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Authentication modes

Set `AUTH_MODE` to one of:

- `replit_oidc` (default)
  - Required: `REPL_ID`
  - Optional: `ISSUER_URL` (defaults to `https://replit.com/oidc`)
- `oidc` (generic provider)
  - Required: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`
  - Optional: `OIDC_CLIENT_SECRET`
- `local` (database-backed email/password)
  - No OIDC env required
  - Create/update local users with:
    - `DATABASE_URL=... pnpm --filter @workspace/db create-local-user <email> <password> [firstName] [lastName]`

Apply the DB changes for multi-auth support:

- `DATABASE_URL=... pnpm --filter @workspace/db migrate:add-multi-auth-support`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
