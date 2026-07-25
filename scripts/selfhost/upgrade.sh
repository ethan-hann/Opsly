#!/usr/bin/env bash
# upgrade.sh — Pull the latest Opsly image/code, rebuild, and restart the
# stack with health-check verification.
#
# Usage:
#   ./scripts/selfhost/upgrade.sh [--env-file <path>] [--skip-backup]
#
# Options:
#   --env-file <path>   Path to the Docker Compose env file.
#                       Defaults to .env.production
#   --skip-backup       Skip the automatic pre-upgrade backup.
#                       Not recommended for production.
#
# The script automatically takes a backup before upgrading (unless
# --skip-backup is passed). If the health check fails after the upgrade,
# the backup directory is printed so you can roll back with restore.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
ENV_FILE=".env.production"
SKIP_BACKUP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --skip-backup)
      SKIP_BACKUP=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--env-file <path>] [--skip-backup]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker is not installed or not on PATH" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Pre-upgrade backup
# ---------------------------------------------------------------------------
BACKUP_DIR=""

if [[ "$SKIP_BACKUP" == "true" ]]; then
  echo "==> Skipping pre-upgrade backup (--skip-backup)"
else
  echo "==> Running pre-upgrade backup ..."
  # Capture the backup directory from backup.sh output
  BACKUP_DIR=$(
    bash "$SCRIPT_DIR/backup.sh" --env-file "$ENV_FILE" 2>&1 | tee /dev/stderr \
      | grep "^==> Backup complete:" | sed 's/^==> Backup complete: //'
  )
  echo ""
fi

# ---------------------------------------------------------------------------
# Pull latest image or code
# ---------------------------------------------------------------------------
echo "==> Pulling latest image / code ..."

# Pull pre-built images if they are in the compose file.
docker compose --env-file "$ENV_FILE" pull --ignore-buildable 2>/dev/null || true

# Pull the latest source code if this is a git checkout.
if [[ -d ".git" ]]; then
  echo "--> git pull ..."
  git pull
fi

# ---------------------------------------------------------------------------
# Rebuild and restart the stack
# ---------------------------------------------------------------------------
echo ""
echo "==> Rebuilding and restarting the stack ..."

docker compose --env-file "$ENV_FILE" up -d --build

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
echo ""
echo "==> Waiting for the API to become healthy ..."

MAX_WAIT=120   # seconds
INTERVAL=5
ELAPSED=0
HEALTHY=false

# Determine the public URL for the health check from WEB_HOST_PORT (if set).
# Fall back to localhost:3000 — the default WEB_HOST_PORT.
WEB_PORT=$(grep -E '^WEB_HOST_PORT=' "$ENV_FILE" 2>/dev/null \
           | cut -d= -f2 | tr -d '[:space:]' || echo "")
WEB_PORT="${WEB_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${WEB_PORT}/api/healthz"

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 3 --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "")

  if [[ "$HTTP_STATUS" == "200" ]]; then
    HEALTHY=true
    break
  fi

  echo "    Waiting for $HEALTH_URL ... (${ELAPSED}s elapsed, HTTP ${HTTP_STATUS:-timeout})"
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
echo ""

if [[ "$HEALTHY" == "true" ]]; then
  echo "==> Upgrade complete. Health check passed: $HEALTH_URL"
else
  echo "ERROR: Health check did not pass within ${MAX_WAIT}s." >&2
  echo ""
  echo "Diagnose with:"
  echo "  docker compose --env-file $ENV_FILE logs --tail=50 api"
  echo ""
  if [[ -n "$BACKUP_DIR" ]]; then
    echo "To roll back to the pre-upgrade snapshot:"
    echo "  ./scripts/selfhost/restore.sh $BACKUP_DIR --env-file $ENV_FILE"
  fi
  exit 1
fi
