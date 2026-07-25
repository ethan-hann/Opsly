# Dockerfile — Multi-stage production image for Opsly API server.
#
# Stages:
#   deps     — install production + dev dependencies (lockfile-cached layer)
#   builder  — compile the API bundle with esbuild
#   runner   — slim runtime image with only the compiled output
#
# Build:
#   docker build -t opsly-api:latest .
#
# For local development use Dockerfile.local instead.

# ── Stage 1: install all dependencies ─────────────────────────────────────────
# Cached as long as pnpm-lock.yaml and workspace package.json files don't change.
FROM node:24-bookworm-slim AS deps

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
# Use a fixed store path so the runner stage can copy and reuse it.
ENV PNPM_STORE_PATH="/pnpm/store"

RUN corepack enable

# Copy only the files that affect dependency resolution so source-code changes
# don't bust this expensive layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY scripts/package.json scripts/preinstall.js ./scripts/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/it-task-manager/package.json ./artifacts/it-task-manager/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/replit-auth-web/package.json ./lib/replit-auth-web/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM deps AS builder

# Copy all source now that node_modules are in place.
COPY . .

# Compile the API bundle (esbuild → artifacts/api-server/dist/index.mjs).
RUN pnpm --filter @workspace/api-server run build

# ── Stage 3: runtime ───────────────────────────────────────────────────────────
# Slim image: only the compiled bundle and a production-only node_modules.
# devDependencies (TypeScript, Vite, esbuild, vitest, @types/* packages, etc.)
# are excluded — only the packages needed to run the API and apply the DB
# schema at startup are installed.
FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NODE_ENV=production
# Reuse the same fixed store path from the deps stage so pnpm can find cached
# packages without hitting the network on every container start.
ENV PNPM_STORE_PATH="/pnpm/store"
# Tell pnpm it's running in CI so it doesn't require a TTY to confirm module-purge operations.
ENV CI=true

RUN corepack enable

# Install wget for the Docker health check (not present in slim images).
RUN apt-get update && apt-get install -y --no-install-recommends wget && \
    rm -rf /var/lib/apt/lists/*

# Copy the pnpm content-addressable store so runtime pnpm commands (drizzle
# push, bootstrap user) don't need to re-download packages from the network.
COPY --from=builder /pnpm/store /pnpm/store

# Copy the compiled bundle.
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist

# Copy workspace manifests needed by pnpm install --prod.
# pnpm-workspace.yaml globs artifacts/* and lib/* so every package
# that appears in the workspace must have a package.json present,
# even if it has no production dependencies.
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json ./

# Copy package manifests for every workspace package so pnpm filter works.
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/artifacts/it-task-manager/package.json ./artifacts/it-task-manager/
COPY --from=builder /app/lib/db/package.json ./lib/db/
COPY --from=builder /app/lib/api-zod/package.json ./lib/api-zod/
COPY --from=builder /app/lib/api-client-react/package.json ./lib/api-client-react/
COPY --from=builder /app/lib/api-spec/package.json ./lib/api-spec/
COPY --from=builder /app/lib/replit-auth-web/package.json ./lib/replit-auth-web/
COPY --from=builder /app/scripts/package.json ./scripts/
# preinstall.js is the workspace preinstall hook referenced in the root
# package.json; pnpm runs it before install and fails if it is missing.
COPY --from=builder /app/scripts/preinstall.js ./scripts/

# Install production dependencies only (excludes devDependencies such as
# TypeScript, Vite, esbuild, vitest, and all @types/* packages).
# --prefer-offline tells pnpm to use the store copy before hitting the network.
RUN pnpm install --prod --frozen-lockfile --prefer-offline

# Copy compiled/source for workspace packages needed at startup.
COPY --from=builder /app/lib/db ./lib/db
COPY --from=builder /app/scripts ./scripts

# Run as a non-root user for security.
RUN groupadd --gid 1001 opsly && \
    useradd --uid 1001 --gid opsly --shell /bin/bash --create-home opsly && \
    mkdir -p /data/exports && \
    chown -R opsly:opsly /data /app /pnpm

USER opsly

# Export file storage mount point.
VOLUME ["/data/exports"]

EXPOSE 8080

# Default command: push DB schema (idempotent) then start the API server.
# The compose file overrides this command to add bootstrap-user creation.
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && node --enable-source-maps artifacts/api-server/dist/index.mjs"]
