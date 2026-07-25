# Self-Hosting Guide

This guide covers everything you need to run Opsly on your own server or
on-premises hardware. It leads with the simplest path — a single VPS with
local disk storage and Caddy as a reverse proxy — then branches into advanced
options for distributed/HA deployments.

> **Local development?** See [LOCAL_DEV.md](LOCAL_DEV.md) instead.

---

## Architecture

The stack is three containers managed by Docker Compose:

```
Internet → reverse proxy (Caddy / Nginx, TLS)
               │
               ▼
          web:80  (nginx — serves static assets, proxies /api/*)
               │
               ▼
          api:8080  (Node.js API server)
               │
               ▼
          db:5432  (PostgreSQL 16)
```

- **web** — nginx serving the pre-built Vite/React bundle. Every `/api/*`
  request is forwarded to the api container over the internal Docker network.
  This is the only container your reverse proxy talks to.
- **api** — the Express API server. It never touches the internet directly.
- **db** — Postgres. Only the api container can reach it.

---

## Contents

1. [System requirements](#system-requirements)
2. [Quick start (single VPS)](#quick-start-single-vps)
3. [Environment variable reference](#environment-variable-reference)
4. [Auth modes](#auth-modes)
5. [Storage](#storage)
6. [Database setup](#database-setup)
7. [Reverse proxy](#reverse-proxy)
8. [First-run bootstrap](#first-run-bootstrap)
9. [Health check](#health-check)
10. [Email notifications](#email-notifications)
11. [Upgrade procedure](#upgrade-procedure)
12. [Backup and restore](#backup-and-restore)

---

## System requirements

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPUs |
| RAM | 512 MB | 2 GB |
| Disk | 10 GB | 50 GB+ |
| OS | Any Docker-capable Linux | Ubuntu 22.04 LTS / Debian 12 |
| Docker | 24+ | latest stable |
| Docker Compose | v2.20+ | latest stable |

A single $6/month VPS (1 vCPU, 1 GB RAM) is sufficient for teams of up to ~50
users. Scale up RAM before CPU — the Postgres query planner benefits most from
memory.

### Docker image size

The production API image (`opsly-api`) is approximately **250–300 MB** compressed.
The runner stage installs only production dependencies — build tools (TypeScript,
Vite, esbuild, vitest, `@types/*` packages) are excluded — so the image is
significantly smaller than a full-dependency build. You can verify the size after
building with:

```sh
docker image ls opsly-api
```

---

## Quick start (single VPS)

This section gets you from zero to a running production instance in about 15
minutes using local disk storage and Caddy for TLS.

### 1. Install Docker

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in after this
```

### 2. Clone the repository (or copy release artifacts)

```sh
git clone https://github.com/your-org/opsly.git
cd opsly
```

### 3. Create your production env file

```sh
cp .env.production.example .env.production
```

Open `.env.production` in your editor. At minimum, set:

```sh
POSTGRES_PASSWORD=<strong-random-password>
SESSION_SECRET=<output of: openssl rand -hex 32>
SECRET_ENCRYPTION_KEY=<output of: openssl rand -hex 32>
INSTANCE_ADMIN_TOKEN=<output of: openssl rand -hex 32>
BOOTSTRAP_ADMIN_EMAIL=you@yourcompany.com
BOOTSTRAP_ADMIN_PASSWORD=<strong-initial-password>
```

Generate each secret independently:

```sh
openssl rand -hex 32   # run once per secret
```

### 4. Build and start the stack

```sh
docker compose --env-file .env.production up -d --build
```

The first start:
1. Boots Postgres and waits for it to be healthy
2. Runs `drizzle-kit push` to apply the database schema (idempotent)
3. Creates the bootstrap admin user if `BOOTSTRAP_ADMIN_EMAIL` is set
4. Starts the API server (internal only, not exposed to the internet)
5. Starts the nginx web container on port 3000 (bound to `127.0.0.1` by default)

### 5. Set up Caddy (reverse proxy + TLS)

See the [Reverse proxy](#reverse-proxy) section for Caddy and Nginx examples.
Point your reverse proxy at **port 3000** (the web container), not 8080.

### 6. Sign in

Navigate to your domain and sign in with the `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD` you set in step 3.

---

## Environment variable reference

All variables are read by the API container. None have defaults that are safe
to use in production without review — change the values marked **⚠ change me**.

### Database

| Variable | Default in compose | Notes |
|---|---|---|
| `POSTGRES_DB` | `opsly` | Database name |
| `POSTGRES_USER` | `opsly` | Postgres user |
| `POSTGRES_PASSWORD` | — | **⚠ change me** — strong random password |
| `DATABASE_URL` | built from above | Set directly only for external databases |

### Auth

| Variable | Default | Notes |
|---|---|---|
| `AUTH_MODE` | `local` | `local` \| `oidc` |
| `OIDC_ISSUER_URL` | — | Required when `AUTH_MODE=oidc` |
| `OIDC_CLIENT_ID` | — | Required when `AUTH_MODE=oidc` |
| `OIDC_CLIENT_SECRET` | — | Required when `AUTH_MODE=oidc` |

### Security

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | **⚠ change me** — signs session cookies; min 32 random bytes |
| `SECRET_ENCRYPTION_KEY` | **⚠ change me** — AES-256-GCM key for at-rest encryption; exactly 64 hex chars (32 bytes) |
| `INSTANCE_ADMIN_TOKEN` | **⚠ change me** — static bearer token for `/api/admin/*` routes |

Generate each with `openssl rand -hex 32`.

### Storage

| Variable | Default | Notes |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` \| `s3` |
| `LOCAL_STORAGE_PATH` | `/data/exports` | Container path; backed by the `opsly-exports` volume |
| `S3_BUCKET` | — | Required when `STORAGE_DRIVER=s3` |
| `S3_REGION` | `us-east-1` | Required when `STORAGE_DRIVER=s3` |
| `S3_ACCESS_KEY_ID` | — | Required when `STORAGE_DRIVER=s3` |
| `S3_SECRET_ACCESS_KEY` | — | Required when `STORAGE_DRIVER=s3` |
| `S3_ENDPOINT` | — | Custom endpoint for MinIO, Cloudflare R2, Backblaze B2, etc. |
| `STORAGE_PREFIX` | `exports/` | Object key prefix |

### Email / SMTP

| Variable | Default | Notes |
|---|---|---|
| `SMTP_HOST` | — | Leave blank to disable email |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | Set `true` for port 465 (SMTPS) |
| `SMTP_USER` | — | |
| `SMTP_PASS` | — | |
| `SMTP_FROM` | `Opsly <noreply@example.com>` | From address |

SMTP is **required for self-service password resets** — without it, users cannot
request a password reset link and an admin must reset passwords manually.
SMTP is also used for notification emails and daily digest summaries.

SMTP settings can also be configured after first login via **Admin → Email**.
Values saved through the UI are encrypted at rest using `SECRET_ENCRYPTION_KEY`.

### Bootstrap admin (first run)

| Variable | Notes |
|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | Creates this user as instance admin on first start (idempotent) |
| `BOOTSTRAP_ADMIN_PASSWORD` | Initial password for the bootstrap admin |
| `BOOTSTRAP_ADMIN_FIRST_NAME` | Defaults to `Admin` |
| `BOOTSTRAP_ADMIN_LAST_NAME` | Defaults to `User` |

### Network

| Variable | Default | Notes |
|---|---|---|
| `WEB_BIND_ADDRESS` | `127.0.0.1` | Bind address for the web (nginx) container — point your reverse proxy here |
| `WEB_HOST_PORT` | `3000` | Host port exposed by the web container |
| `BIND_ADDRESS` | `127.0.0.1` | Bind address for the API container — internal only; no need to expose publicly |
| `HOST_PORT` | `8080` | Host port exposed by the API container |

---

## Auth modes

### Local (email/password)

The default mode. No external identity provider required. Set
`BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` for the first admin.
Additional users can self-register or be invited from the admin panel.

### Generic OIDC

Works with any OIDC-compliant provider (Keycloak, Authentik, Okta, Auth0, etc.).

```sh
AUTH_MODE=oidc
OIDC_ISSUER_URL=https://your-idp.example.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

Register `https://your-domain.com/api/auth/oidc/callback` as the redirect URI
in your identity provider.

---

## Storage

### Local disk (default — single-server deployments)

Export files are written to the `opsly-exports` Docker named volume, mounted
at `/data/exports` inside the container. This volume persists across container
restarts.

```sh
STORAGE_DRIVER=local
```

**Back up this volume** as part of your regular backup procedure (see
[Backup and restore](#backup-and-restore)). Do not use this driver with
multiple API replicas — each replica would have its own isolated volume.

### S3-compatible (distributed / HA deployments)

Works with AWS S3, MinIO, Cloudflare R2, Backblaze B2, and any other
S3-compatible store.

```sh
STORAGE_DRIVER=s3
S3_BUCKET=opsly-exports
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
# S3_ENDPOINT=         # omit for AWS S3
# STORAGE_PREFIX=exports/
```

#### MinIO example (self-hosted S3, no cloud dependency)

Add a MinIO service to your compose stack or run it separately. Example
standalone MinIO setup:

```yaml
# Add to docker-compose.yml services section
minio:
  image: minio/minio:latest
  restart: unless-stopped
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minio}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?}
  volumes:
    - minio-data:/data
  ports:
    - "127.0.0.1:9000:9000"   # S3 API (reverse-proxy this)
    - "127.0.0.1:9001:9001"   # MinIO console

volumes:
  minio-data:
```

Then configure Opsly to use it:

```sh
STORAGE_DRIVER=s3
S3_BUCKET=opsly-exports
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
S3_ENDPOINT=http://minio:9000   # internal Docker network name
```

Create the `opsly-exports` bucket in MinIO's console (`http://localhost:9001`)
before starting Opsly.

---

## Database setup

### Using the bundled Postgres container

The default `docker-compose.yml` includes a Postgres 16 container with a
persistent named volume. This is suitable for most self-hosted deployments.

Data is stored in the `opsly-postgres-data` volume. Back this up regularly.

### Using an external / managed database

Set `DATABASE_URL` directly and remove the `POSTGRES_*` environment variables:

```sh
DATABASE_URL=postgresql://opsly:password@your-db-host:5432/opsly
```

Managed options: Amazon RDS, Google Cloud SQL, Supabase, Neon, Render
Postgres, Railway Postgres. Use Postgres 15 or 16.

Remove the `db` service and its volume from `docker-compose.yml` if you use an
external database.

### Schema migrations

The API server runs `pnpm --filter @workspace/db run push` on every startup.
This is idempotent — it is safe to run against an already-migrated database and
will apply only the changes needed to bring the schema up to date. No manual
migration steps are required during upgrades.

---

## Reverse proxy

The API server binds to `127.0.0.1:8080` by default. A reverse proxy handles
TLS termination and routes HTTPS traffic to the container.

The web container (nginx) is the public entry point — it serves the frontend
and proxies `/api/*` to the API. Point your reverse proxy at **port 3000**
(or whichever port you set as `WEB_HOST_PORT`).

### Caddy (recommended — automatic TLS)

Install Caddy: https://caddyserver.com/docs/install

Create `/etc/caddy/Caddyfile`:

```caddyfile
your-domain.com {
    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Reload Caddy:

```sh
sudo systemctl reload caddy
```

Caddy automatically provisions and renews a Let's Encrypt TLS certificate.
SSE (real-time notifications) and WebSocket connections are proxied
transparently — no extra configuration needed.

### Nginx

Install Nginx and Certbot, obtain a certificate, then create
`/etc/nginx/sites-available/opsly`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # WebSocket / SSE upgrade passthrough.
    proxy_http_version  1.1;
    proxy_set_header    Upgrade $http_upgrade;
    proxy_set_header    Connection "upgrade";

    proxy_set_header    Host $host;
    proxy_set_header    X-Real-IP $remote_addr;
    proxy_set_header    X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header    X-Forwarded-Proto $scheme;

    # Increase timeout for long-running export jobs and SSE streams.
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;

    # Forward everything to the web container (nginx serves the UI
    # and proxies /api/* internally to the API container).
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

Enable and reload:

```sh
sudo ln -s /etc/nginx/sites-available/opsly /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Obtain a certificate:

```sh
sudo certbot --nginx -d your-domain.com
```

---

## First-run bootstrap

### Automatic (recommended)

Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in your env file
before the first `docker compose up`. The startup script creates the user and
promotes them to instance admin. The create-user script is idempotent — it
prints "already exists, skipping" on subsequent starts.

### Manual

If you prefer not to put the initial password in your env file:

```sh
# 1. Start the stack without bootstrap vars
docker compose --env-file .env.production up -d

# 2. Create the user manually
docker compose --env-file .env.production exec api \
  pnpm --filter @workspace/db run create-local-user \
    admin@example.com 'StrongPassword123!' Admin User

# 3. Promote to instance admin
docker compose --env-file .env.production exec api \
  pnpm --filter @workspace/db run make-admin admin@example.com
```

---

## Health check

The API exposes a health endpoint for uptime monitoring:

```
GET /api/healthz
```

Expected response (`200 OK`):

```json
{ "status": "ok" }
```

Example with curl:

```sh
curl https://your-domain.com/api/healthz
```

Configure your uptime monitor (UptimeRobot, Betterstack, etc.) to check this
endpoint every 60 seconds. The Docker Compose stack also uses this endpoint
for its internal container health check.

---

## Email notifications

Email is optional. Without it, Opsly works fully — users just won't receive
notification emails or digest summaries.

### Configure via environment variables

Set the `SMTP_*` variables in your env file before starting the stack.

### Configure via the admin panel

1. Sign in as an instance admin
2. Go to **Admin → Email settings**
3. Enter your SMTP credentials and send a test email

Settings saved through the UI are encrypted at rest using `SECRET_ENCRYPTION_KEY`.

### Recommended SMTP providers

- **Resend** — generous free tier, excellent deliverability
- **Postmark** — reliable transactional email
- **AWS SES** — very low cost at scale
- **Self-hosted Postfix/Mailcow** — no external dependency, more operational overhead

---

## Upgrade procedure

1. **Pull the latest image or code:**

   ```sh
   # If using a pre-built image, update OPSLY_IMAGE in .env.production, then:
   docker compose --env-file .env.production pull

   # If building locally:
   git pull
   ```

2. **Restart the stack:**

   ```sh
   docker compose --env-file .env.production up -d --build
   ```

   On startup, the API runs `pnpm --filter @workspace/db run push` which
   applies any schema changes automatically. No manual migration steps are
   required.

3. **Verify the health check:**

   ```sh
   curl https://your-domain.com/api/healthz
   # Expected: {"status":"ok"}
   ```

**Downtime during upgrades** is typically under 30 seconds (the time for the
new container to start and apply schema changes). For zero-downtime upgrades,
run a load balancer across multiple API replicas and use a shared S3 storage
driver and managed Postgres.

---

## Backup and restore

### What to back up

| Data | Location | Method |
|---|---|---|
| PostgreSQL database | `opsly-postgres-data` volume | `pg_dump` (see below) |
| Export files | `opsly-exports` volume | Volume backup or S3 versioning |

### Database backup

```sh
# Dump to a compressed file
docker compose --env-file .env.production exec db \
  pg_dump -U opsly opsly | gzip > opsly-backup-$(date +%Y%m%d).sql.gz

# Restore from a dump
gunzip -c opsly-backup-20260101.sql.gz | \
  docker compose --env-file .env.production exec -T db \
  psql -U opsly opsly
```

Schedule daily backups with cron and ship them to S3 or another off-site
store. Retain at least 7 daily and 4 weekly backups.

### Export volume backup

```sh
# Tar the exports volume
docker run --rm \
  -v opsly_opsly-exports:/source:ro \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/exports-$(date +%Y%m%d).tar.gz -C /source .
```

If you use `STORAGE_DRIVER=s3`, enable versioning on the S3 bucket instead of
backing up the volume — the volume is not used in that mode.

### Managed database backup

If you use a managed database (RDS, Supabase, etc.), use the provider's
built-in point-in-time recovery (PITR) and snapshot features. These are
generally more reliable than manual `pg_dump` scripts.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Container exits immediately | Check logs: `docker compose logs api` — look for missing required env vars |
| `SESSION_SECRET is required` | Set `SESSION_SECRET` in your env file |
| `SECRET_ENCRYPTION_KEY is required` | Set `SECRET_ENCRYPTION_KEY` in your env file (must be 64 hex chars) |
| `POSTGRES_PASSWORD is required` | Set `POSTGRES_PASSWORD` in your env file |
| DB health check keeps failing | Check disk space; Postgres needs free space to start |
| `/api/healthz` returns 502 | The API container hasn't started yet — check `docker compose logs api` |
| Browser shows blank page or 502 | The web container is waiting for the API — check `docker compose logs web`; the API health check must pass before the web container starts |
| Export download fails | Check `STORAGE_DRIVER` and that the exports volume is mounted; for S3, verify credentials |
| Can't sign in after OIDC setup | Verify the redirect URI registered with your IdP matches `https://your-domain.com/api/auth/oidc/callback` |
