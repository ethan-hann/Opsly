#!/bin/bash
set -e

# An automated merge can leave git in a mid-rebase state; abort any stale rebase
# before doing anything else so the working tree recovers.
git rebase --abort 2>/dev/null || true

# Install any new dependencies added by the merged task
pnpm install --frozen-lockfile

# Push schema changes to the database (idempotent, non-interactive)
pnpm --filter @workspace/db run push-force

# Rebuild the API server so new routes and code are live
pnpm --filter @workspace/api-server run build
