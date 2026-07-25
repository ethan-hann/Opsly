# #329 — Prevent a crashed digest worker from blocking retries for up to 20 hours

**State:** PROPOSED
**Depends on:** #295

---

# Prevent a crashed digest worker from blocking retries for up to 20 hours

## What & Why
`CLAIM_TTL_MS` is currently set equal to `DAILY_GAP_MS` (20 hours). If a process crashes mid-send and leaves `digestClaimedAt` set, the next run won't be able to re-claim that user until the 20-hour TTL expires — effectively silently skipping one entire digest cycle. A crash-recovery TTL should be much shorter (e.g. 10–30 minutes), independent of the send frequency.

## Done looks like
- `CLAIM_TTL_MS` is a distinct, shorter constant (e.g. 30 minutes)
- Existing tests updated/extended to reflect the shorter cutoff
- A comment explains the intentional separation between send frequency and claim TTL

## Relevant files
- `artifacts/api-server/src/lib/digest-mailer.ts` — `CLAIM_TTL_MS` constant and claim WHERE clause
- `artifacts/api-server/src/lib/digest-mailer.test.ts`
