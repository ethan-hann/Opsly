# Local Development Guide

> **Going to production?** See [SELF_HOSTING.md](SELF_HOSTING.md) for the
> production Docker Compose, environment variable reference, reverse proxy
> examples, and upgrade procedure.

Run the full app stack locally using either Docker (recommended, zero config) or
a native Node + pnpm setup.

## Quick start

### Docker (one command)

```sh
docker compose -f docker-compose.local.yml up --build
```


Open **http://localhost:20999** and sign in with `admin@example.com` / `changeme`.

To customise env vars, copy the example file first:

```sh
cp .env.example .env
# edit .env as needed
docker compose -f docker-compose.local.yml up --build
```

Docker Compose reads `.env` automatically — no `--env-file` flag required.

### Native dev (two commands)

```sh
# One-time setup: push DB schema and create default local user
pnpm run setup

# Start API + frontend together
pnpm run dev
```

Or with the shell wrapper (sources `.env` automatically):

```sh
# bash / sh
./scripts/dev.sh --setup   # first run only
./scripts/dev.sh

# PowerShell
./scripts/dev.ps1 -Setup   # first run only
./scripts/dev.ps1
```

Open **http://localhost:20999** and sign in with `admin@example.com` / `changeme`.

---

## Prerequisites

- Node.js 24.x
- pnpm installed globally (`npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest --activate`)
- PostgreSQL 16+ running locally (or use the Docker stack above)

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.  All variables have
sensible defaults for local development; no changes are required to get started.

```sh
# bash / sh
cp .env.example .env

# PowerShell
Copy-Item .env.example .env
```

Key variables:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/opsly` | Postgres connection string |
| `AUTH_MODE` | `local` | `local` \| `oidc` \| `replit_oidc` |
| `STORAGE_DRIVER` | `local` | `local` \| `s3` \| `replit` |
| `LOCAL_STORAGE_PATH` | `./data/exports` | Directory for export files (local driver) |
| `INSTANCE_ADMIN_TOKEN` | `local-dev-admin-token` | Static bearer token for instance-admin access |

## Auth modes

The default is **local** (email/password). To switch:

### Local login (default)

No extra config needed. The setup step creates `admin@example.com` / `changeme`.

```sh
# bash / sh
export AUTH_MODE=local

# PowerShell
$env:AUTH_MODE = "local"
```

### Replit OIDC

```sh
# bash / sh
export AUTH_MODE=replit_oidc
export REPL_ID="<your-repl-id>"
# export ISSUER_URL="https://replit.com/oidc"  # optional

# PowerShell
$env:AUTH_MODE = "replit_oidc"
$env:REPL_ID = "<your-repl-id>"
```

### Generic OIDC

```sh
# bash / sh
export AUTH_MODE=oidc
export OIDC_ISSUER_URL="https://your-issuer.example.com"
export OIDC_CLIENT_ID="<client-id>"
# export OIDC_CLIENT_SECRET="<client-secret>"  # if required

# PowerShell
$env:AUTH_MODE = "oidc"
$env:OIDC_ISSUER_URL = "https://your-issuer.example.com"
$env:OIDC_CLIENT_ID = "<client-id>"
```

## Storage

Export files are stored locally by default (`STORAGE_DRIVER=local`), written to
`./data/exports/` (or `LOCAL_STORAGE_PATH`). No cloud bucket is needed for local
or Docker dev.

To use S3-compatible storage, set `STORAGE_DRIVER=s3` and fill in the `S3_*`
variables in `.env`.

## Native dev: step by step

### 1. Install dependencies

```sh
pnpm install --frozen-lockfile
```

If pnpm asks for build approvals:

```sh
pnpm approve-builds
```

Approve `esbuild` (and any other expected workspace build dependency).

### 2. Start Postgres

Use the Docker-only Postgres service if you don't have a local instance:

```sh
docker compose -f docker-compose.local.yml up db -d
```

Or point `DATABASE_URL` at any reachable Postgres 16+ instance.

### 3. First-time setup

```sh
# bash / sh
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opsly"
pnpm run setup

# PowerShell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/opsly"
pnpm run setup
```

This pushes the DB schema and creates the default local admin user
(`admin@example.com` / `changeme`). The `setup` script always uses these
fixed defaults. To use different credentials, run the DB scripts directly:

> **Safe to re-run.** `pnpm run setup` is idempotent — if the user already
> exists it prints "already exists, skipping" and exits successfully. Run it
> again after a `git pull`, a schema change, or any time you want to make sure
> the workspace is fully initialized.


```sh
# bash / sh
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run create-local-user your@email.com yourpass First Last
pnpm --filter @workspace/db run make-admin your@email.com

# PowerShell (same commands)
```

### 4. Start the dev servers

```sh
# bash / sh
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opsly"
pnpm run dev

# PowerShell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/opsly"
pnpm run dev
```

`pnpm run dev` starts the API server (`:8080`) and Vite frontend (`:20999`)
concurrently in a single terminal.

### 5. Open the app

```
http://localhost:20999
```

Sign in with `admin@example.com` / `changeme` (or whatever you set in `.env`).

## Docker: details

Services started by `docker compose -f docker-compose.local.yml up --build`:

| Service | URL |
|---|---|
| Frontend (Vite dev) | http://localhost:20999 |
| API server | http://localhost:8080/api |
| Postgres | localhost:5432 (db: `opsly`, user/pass: `postgres`) |

What the stack does automatically on first start:

1. Starts Postgres
2. Pushes the DB schema (`pnpm --filter @workspace/db run push`)
3. Creates the default local user (`admin@example.com` / `changeme`)
4. Promotes that user to instance admin

Export files are persisted in the `opsly-exports` named Docker volume, mounted
at `/data/exports` inside the API container.

### Override auth mode in Docker

Inline (one-off):

```sh
# bash / sh
AUTH_MODE=oidc \
  OIDC_ISSUER_URL=https://your-issuer.example.com \
  OIDC_CLIENT_ID=your-client-id \
  docker compose -f docker-compose.local.yml up --build

# PowerShell
$env:AUTH_MODE = "oidc"
$env:OIDC_ISSUER_URL = "https://your-issuer.example.com"
$env:OIDC_CLIENT_ID = "your-client-id"
docker compose -f docker-compose.local.yml up --build
```

Via `.env` (recommended for repeat use):

```sh
cp .env.example .env
# set AUTH_MODE=oidc and the OIDC_* vars in .env
docker compose -f docker-compose.local.yml up --build
```

### Stop and clean up

```sh
# bash / sh
docker compose -f docker-compose.local.yml down      # stop services, keep volumes
docker compose -f docker-compose.local.yml down -v   # also remove DB + export volumes

# PowerShell
docker compose -f docker-compose.local.yml down
docker compose -f docker-compose.local.yml down -v
```

## Useful commands

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/it-task-manager test
```

## Common issues

| Symptom | Fix |
|---|---|
| `ERR_PNPM_IGNORED_BUILDS` | Run `pnpm approve-builds` and approve `esbuild` |
| `PORT environment variable is required` | Set `PORT` before starting the server manually, or use `pnpm run dev` which sets it automatically |
| `BASE_PATH environment variable is required` | Use `pnpm run dev` or set `BASE_PATH=/` before starting the frontend |
| Login fails in local mode | Ensure `AUTH_MODE=local` and run the setup step to create a local user |
| Export download fails | Check `STORAGE_DRIVER=local` and that `LOCAL_STORAGE_PATH` is writable |
