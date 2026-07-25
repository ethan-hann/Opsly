#!/bin/bash
set -e

# The Replit task-agent merge mechanism can leave git in a mid-rebase state.
# Abort any stale rebase before doing anything else so the Git panel recovers.
git rebase --abort 2>/dev/null || true

# Install any new dependencies added by the merged task
pnpm install --frozen-lockfile

# Push schema changes to the database (idempotent, non-interactive)
pnpm --filter @workspace/db run push-force

# Rebuild the API server so new routes and code are live
pnpm --filter @workspace/api-server run build
