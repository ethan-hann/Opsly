#!/bin/bash
set -e

# Install any new dependencies added by the merged task
pnpm install --frozen-lockfile

# Push schema changes to the database (idempotent, non-interactive)
pnpm --filter @workspace/db run push-force

# Rebuild the API server so new routes and code are live
pnpm --filter @workspace/api-server run build
