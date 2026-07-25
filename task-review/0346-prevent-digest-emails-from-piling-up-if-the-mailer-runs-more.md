# #346 — Prevent digest emails from piling up if the mailer runs more than once per hour

**State:** PROPOSED
**Depends on:** #294

---

# Prevent digest emails from piling up if the mailer runs more than once per hour

## What & Why
The claim TTL is set to CLAIM_TTL_MS = DAILY_GAP_MS (20 h). If the hourly interval fires slightly early due to clock drift, or if a manual trigger overlaps an in-progress run, two claim attempts could land in the same window. Adding a short in-process mutex (e.g. a module-level boolean flag) would prevent overlapping runDigest executions in the same process without relying solely on the DB-level OCC guard.

## Done looks like
- runDigest is guarded so a second invocation while one is already running is a no-op
- Existing tests continue to pass; a new test confirms the guard fires

## Relevant files
- `artifacts/api-server/src/lib/digest-mailer.ts`
- `artifacts/api-server/src/lib/digest-mailer.test.ts`
