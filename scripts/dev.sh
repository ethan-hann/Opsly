#!/usr/bin/env sh
# dev.sh — start the full local dev stack (API + frontend) in one terminal.
#
# Usage:
#   ./scripts/dev.sh
#
# On first run, complete the one-time setup first:
#   ./scripts/dev.sh --setup
#
# Environment (override by exporting before running, or via .env):
#   DATABASE_URL          — default: postgresql://postgres:postgres@localhost:5432/opsly
#   PORT (API)            — default: 8080
#   VITE_PORT (frontend)  — default: 20999
#   AUTH_MODE             — default: local
#   STORAGE_DRIVER        — default: local

set -e

# Load .env if it exists and is not already sourced.
if [ -f "$(dirname "$0")/../.env" ]; then
  # Export each non-comment, non-empty line.
  set -a
  # shellcheck disable=SC1091
  . "$(dirname "$0")/../.env"
  set +a
fi

# Defaults
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/opsly}"
export AUTH_MODE="${AUTH_MODE:-local}"
export STORAGE_DRIVER="${STORAGE_DRIVER:-local}"
export LOCAL_STORAGE_PATH="${LOCAL_STORAGE_PATH:-./data/exports}"
export INSTANCE_ADMIN_TOKEN="${INSTANCE_ADMIN_TOKEN:-local-dev-admin-token}"

export NODE_ENV="${NODE_ENV:-development}"

if [ "$1" = "--setup" ]; then
  echo "==> Running one-time setup (DB schema push + default local user)..."
  pnpm run setup
  echo "==> Setup complete."
fi

echo "==> Starting API server on :8080 and frontend on :20999..."

# The root `dev` script uses concurrently and sets PORT per process.
pnpm run dev
