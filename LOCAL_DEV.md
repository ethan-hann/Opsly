# Local Development Guide

This guide is for running the app locally on Windows (PowerShell), including:

- API server
- Web app (Vite frontend)
- PostgreSQL database
- Auth configuration (Replit OIDC, generic OIDC, or local DB login)

You can run locally in two ways:

- Native local workflow (Node + pnpm + local Postgres)
- Docker workflow (app + Postgres via `docker compose`)

## 1) Prerequisites

- Node.js 24.x
- pnpm installed globally
- PostgreSQL 16+ running locally (or a reachable Postgres instance)

## 2) Install dependencies

From repository root:

```powershell
pnpm install --frozen-lockfile
```

If pnpm asks for build approvals:

```powershell
pnpm approve-builds
```

Approve `esbuild` (and any other expected workspace build dependency).

## 3) Database setup

Set your DB URL in the current shell:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/opsly"
```

Push schema:

```powershell
pnpm --filter @workspace/db run push
```

Apply multi-auth migration:

```powershell
pnpm --filter @workspace/db run migrate:add-multi-auth-support
```

## 4) Choose auth mode

Set one of the following before starting the API server.

### Option A: Local login (easiest for local dev)

```powershell
$env:AUTH_MODE = "local"
```

Create a local user:

```powershell
pnpm --filter @workspace/db run create-local-user -- admin@example.com changeme Admin User
```

### Option B: Replit OIDC

```powershell
$env:AUTH_MODE = "replit_oidc"
$env:REPL_ID = "<your-repl-id>"
# Optional:
# $env:ISSUER_URL = "https://replit.com/oidc"
```

### Option C: Generic OIDC

```powershell
$env:AUTH_MODE = "oidc"
$env:OIDC_ISSUER_URL = "https://your-issuer.example.com"
$env:OIDC_CLIENT_ID = "<client-id>"
# Optional:
# $env:OIDC_CLIENT_SECRET = "<client-secret>"
```

## 5) Start API server (Terminal 1)

The API requires `PORT`. For local parity with artifact config:

```powershell
$env:PORT = "8080"
$env:NODE_ENV = "development"
pnpm --filter @workspace/api-server run build
node --enable-source-maps artifacts\api-server\dist\index.mjs
```

Notes:

- `STORAGE_DRIVER` defaults to `replit`. Missing bucket config is non-fatal in development (export features disabled).
- You can set `INSTANCE_ADMIN_TOKEN` if you need static instance-admin access:

```powershell
$env:INSTANCE_ADMIN_TOKEN = "<long-random-token>"
```

## 6) Start frontend (Terminal 2)

```powershell
$env:PORT = "20999"
$env:BASE_PATH = "/"
# Optional if your API runs elsewhere:
# $env:API_PROXY_TARGET = "http://127.0.0.1:8080"
pnpm --filter @workspace/it-task-manager run dev
```

Open:

```text
http://localhost:20999/
```

The Vite dev server proxies `/api/*` requests to `API_PROXY_TARGET` (default `http://127.0.0.1:8080`).

## 7) Useful validation commands

```powershell
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/it-task-manager test
```

## 8) Common issues

- `ERR_PNPM_IGNORED_BUILDS`: run `pnpm approve-builds`.
- `PORT environment variable is required`: set `PORT` in each terminal before start.
- `BASE_PATH environment variable is required`: set `$env:BASE_PATH = "/"` for frontend.
- OIDC login errors in local mode: ensure `$env:AUTH_MODE = "local"` and create a local user.

## 9) Docker local stack (optional)

If you prefer containerized local dev with Postgres included:

### Prerequisites

- Docker Desktop
- Docker Compose v2 (`docker compose`)

### Start everything

From repository root:

```powershell
docker compose -f docker-compose.local.yml up --build
```

Or with an env file:

```powershell
Copy-Item .env.docker.example .env.docker
# edit .env.docker as needed
docker compose --env-file .env.docker -f docker-compose.local.yml up --build
```

Services:

- Web: `http://localhost:20999`
- API: `http://localhost:8080/api`
- Postgres: `localhost:5432` (db: `opsly`, user: `postgres`, password: `postgres`)

What this stack does automatically:

- Starts Postgres
- Runs DB schema push + `migrate:add-multi-auth-support`
- Creates a default local user in local auth mode:
  - email: `admin@example.com`
  - password: `changeme`

### Override auth mode/env in Docker

You can use either:

- inline env vars (quick one-off), or
- `.env.docker` (recommended for repeat use)

Inline example:

```powershell
$env:AUTH_MODE = "oidc"
$env:OIDC_ISSUER_URL = "https://your-issuer.example.com"
$env:OIDC_CLIENT_ID = "your-client-id"
$env:OIDC_CLIENT_SECRET = "your-client-secret"
docker compose -f docker-compose.local.yml up --build
```

`.env.docker` example:

```text
AUTH_MODE=oidc
OIDC_ISSUER_URL=https://your-issuer.example.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

### Stop and clean up

```powershell
docker compose -f docker-compose.local.yml down
```

Remove DB volume too:

```powershell
docker compose -f docker-compose.local.yml down -v
```
