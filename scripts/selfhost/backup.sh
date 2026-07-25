#!/usr/bin/env bash
# backup.sh — Back up the Opsly database and exports volume to a timestamped
# directory under ./backups/.
#
# Usage:
#   ./scripts/selfhost/backup.sh [--env-file <path>]
#
# Options:
#   --env-file <path>   Path to the Docker Compose env file.
#                       Defaults to .env.production
#
# The backup directory is: ./backups/YYYYMMDD-HHMMSS/
#   opsly-db.sql.gz     — compressed pg_dump of the database
#   exports.tar.gz      — tarball of the opsly-exports Docker volume
#
# Restore with:
#   ./scripts/selfhost/restore.sh ./backups/YYYYMMDD-HHMMSS

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
ENV_FILE=".env.production"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--env-file <path>]" >&2
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
# Setup
# ---------------------------------------------------------------------------
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="./backups/${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "==> Opsly backup — $(date)"
echo "    env file   : $ENV_FILE"
echo "    backup dir : $BACKUP_DIR"
echo ""

# ---------------------------------------------------------------------------
# Database backup (pg_dump via the running db container)
# ---------------------------------------------------------------------------
echo "--> Dumping database ..."

DB_FILE="${BACKUP_DIR}/opsly-db.sql.gz"

docker compose --env-file "$ENV_FILE" exec -T db \
  pg_dump -U opsly opsly \
  | gzip > "$DB_FILE"

DB_SIZE=$(du -sh "$DB_FILE" | cut -f1)
echo "    saved: $DB_FILE ($DB_SIZE)"

# ---------------------------------------------------------------------------
# Exports volume backup
# ---------------------------------------------------------------------------
echo "--> Backing up exports volume ..."

EXPORTS_FILE="${BACKUP_DIR}/exports.tar.gz"

docker run --rm \
  -v opsly_opsly-exports:/source:ro \
  -v "$(pwd)/${BACKUP_DIR}":/backup \
  alpine tar czf /backup/exports.tar.gz -C /source . 2>/dev/null || {
    # Volume may not exist if STORAGE_DRIVER=s3 is in use
    echo "    WARNING: opsly_opsly-exports volume not found or empty." \
         "Skipping volume backup (expected if STORAGE_DRIVER=s3)."
    EXPORTS_FILE=""
  }

if [[ -n "$EXPORTS_FILE" && -f "$EXPORTS_FILE" ]]; then
  EXPORTS_SIZE=$(du -sh "$EXPORTS_FILE" | cut -f1)
  echo "    saved: $EXPORTS_FILE ($EXPORTS_SIZE)"
fi

# ---------------------------------------------------------------------------
# Write metadata
# ---------------------------------------------------------------------------
cat > "${BACKUP_DIR}/backup-info.txt" <<EOF
Opsly Backup
============
Timestamp : ${TIMESTAMP}
Env file  : ${ENV_FILE}
Host      : $(hostname)
EOF

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "==> Backup complete: $BACKUP_DIR"
echo ""
echo "    To restore:"
echo "    ./scripts/selfhost/restore.sh $BACKUP_DIR"
