# #513 — Prevent a missed backup from going unnoticed for days

**State:** PROPOSED
**Depends on:** #499

---

# Prevent a missed backup from going unnoticed for days

## What & Why

`backup.sh` exits non-zero on failure, but a cron job that silently fails produces no alert. A lightweight notification hook (POST to a webhook URL on success/failure — compatible with Healthchecks.io, Betterstack, Uptime Kuma, ntfy.sh, etc.) lets self-hosters know immediately if a backup was skipped.

## Done looks like

- `backup.sh` accepts an optional `--ping-url <url>` argument
- On success it sends `GET <url>` (heartbeat); on failure it sends `GET <url>/fail`
- SELF_HOSTING.md shows a cron example with the ping URL
- No new dependencies — uses curl, which is already required

## Relevant files

- `scripts/selfhost/backup.sh`
- `SELF_HOSTING.md` (Backup and restore section, cron example)
