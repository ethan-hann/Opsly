# #512 — Let self-hosters verify a backup is valid before relying on it for disaster recovery

**State:** PROPOSED
**Depends on:** #499

---

# Let self-hosters verify a backup is valid before relying on it for disaster recovery

## What & Why

`backup.sh` creates the archive files but does not verify them. A corrupt or truncated dump would only be discovered during a real restore — the worst possible time. A `verify.sh` script that runs a test restore into a temporary Postgres container and checks the row count gives self-hosters confidence their backup actually works.

## Done looks like

- `scripts/selfhost/verify.sh <backup-dir>` spins up a throwaway Postgres container, restores the dump, runs a basic sanity query (table count, row count), and prints pass/fail
- SELF_HOSTING.md mentions the verify script in the Backup section
- The script cleans up the temporary container on exit

## Relevant files

- `scripts/selfhost/backup.sh`
- `scripts/selfhost/restore.sh`
- `SELF_HOSTING.md` (Backup and restore section)
