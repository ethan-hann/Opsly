#!/usr/bin/env bash
# restore.sh — Restore an Opsly backup created by backup.sh.
#
# Usage:
#   ./scripts/selfhost/restore.sh <backup-dir> [--env-file <path>]
#
# Arguments:
#   <backup-dir>        Path to the backup directory produced by backup.sh,
#                       e.g. ./backups/20260725-143000
#
# Options:
#   --env-file <path>   Path to the Docker Compose env file.
#                       Defaults to .env.production
#
# WARNING: This will OVERWRITE the current database and exports volume.
# Stop application traffic before running this script.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
ENV_FILE=".env.production"
BACKUP_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    -*)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 <backup-dir> [--env-file <path>]" >&2
      exit 1
      ;;
    *)
      if [[ -z "$BACKUP_DIR" ]]; then
        BACKUP_DIR="$1"
      else
        echo "Unexpected argument: $1" >&2
        echo "Usage: $0 <backup-dir> [--env-file <path>]" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ -z "$BACKUP_DIR" ]]; then
  echo "ERROR: backup directory is required." >&2
  echo "Usage: $0 <backup-dir> [--env-file <path>]" >&2
  exit 1
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "ERROR: backup directory not found: $BACKUP_DIR" >&2
  exit 1
fi

DB_FILE="${BACKUP_DIR}/opsly-db.sql.gz"
if [[ ! -f "$DB_FILE" ]]; then
  echo "ERROR: database dump not found in backup directory: $DB_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker is not installed or not on PATH" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------
echo ""
echo "==> Opsly restore"
echo ""
echo "    WARNING: This will OVERWRITE the current database and exports volume."
echo ""
echo "    backup dir : $BACKUP_DIR"
echo "    env file   : $ENV_FILE"
echo ""
read -r -p "Type YES to continue: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

# ---------------------------------------------------------------------------
# Restore the database
# ---------------------------------------------------------------------------
echo "--> Restoring database ..."

# Drop and recreate the database so the restore is clean.
# The db container must be running; the api container does not need to be.
docker compose --env-file "$ENV_FILE" exec -T db \
  psql -U opsly -d postgres -c "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = 'opsly' AND pid <> pg_backend_pid();
    DROP DATABASE IF EXISTS opsly;
    CREATE DATABASE opsly OWNER opsly;
  "

gunzip -c "$DB_FILE" | \
  docker compose --env-file "$ENV_FILE" exec -T db \
  psql -U opsly opsly

echo "    Database restored."

# ---------------------------------------------------------------------------
# Restore the exports volume
# ---------------------------------------------------------------------------
EXPORTS_FILE="${BACKUP_DIR}/exports.tar.gz"

if [[ -f "$EXPORTS_FILE" ]]; then
  echo "--> Restoring exports volume ..."

  # Clear the existing volume contents, then extract the backup.
  docker run --rm \
    -v opsly_opsly-exports:/target \
    -v "$(realpath "$BACKUP_DIR")":/backup:ro \
    alpine sh -c "rm -rf /target/* /target/.[!.]* 2>/dev/null; tar xzf /backup/exports.tar.gz -C /target"

  echo "    Exports volume restored."
else
  echo "--> No exports.tar.gz found in backup — skipping volume restore."
  echo "    (Expected if STORAGE_DRIVER=s3 was in use at backup time.)"
fi

# ---------------------------------------------------------------------------
# Restart the stack so the API picks up the restored data
# ---------------------------------------------------------------------------
echo "--> Restarting the stack ..."
docker compose --env-file "$ENV_FILE" up -d

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
echo "--> Waiting for the API to become healthy ..."
RETRIES=20
HEALTHY=false

for i in $(seq 1 "$RETRIES"); do
  STATUS=$(docker compose --env-file "$ENV_FILE" exec -T db \
    psql -U opsly opsly -tAc "SELECT 1" 2>/dev/null || echo "")
  if [[ "$STATUS" == "1" ]]; then
    HEALTHY=true
    break
  fi
  echo "    Waiting ... ($i/$RETRIES)"
  sleep 3
done

if [[ "$HEALTHY" != "true" ]]; then
  echo "WARNING: Database did not respond after restart — check logs with:" >&2
  echo "         docker compose --env-file $ENV_FILE logs db" >&2
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "==> Restore complete."
echo ""
echo "    Verify the application is healthy:"
echo "    curl https://your-domain.com/api/healthz"
