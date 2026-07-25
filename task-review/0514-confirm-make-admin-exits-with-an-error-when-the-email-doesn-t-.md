# #514 — Confirm make-admin exits with an error when the email doesn't exist in the database

**State:** PROPOSED
**Depends on:** #500

---

# Confirm make-admin exits with an error when the email doesn't exist in the database

## What & Why

The `make-admin` script logs an error and calls `process.exit(1)` when no user is found for the given email. There is no automated test for this path, so a future edit could accidentally swallow the error or exit 0 instead.

## Done looks like

- A vitest spec in `lib/db/src/make-admin.test.ts` runs the script with an email that doesn't exist in the DB
- The script exits non-zero
- stderr contains "No user found with email"
- `is_instance_admin` rows are unchanged

## Relevant files

- `lib/db/src/make-admin.ts`
- `lib/db/src/make-admin.test.ts`
- `lib/db/src/create-local-user.test.ts` (pattern to follow)
