# #244 — Confirm the SLA breach email is not sent twice if detectAndMarkSlaBreaches races on the same task

**State:** PROPOSED
**Depends on:** #173

---

# Guard the atomic CAS in detectAndMarkSlaBreaches against double-email

## What & Why
detectAndMarkSlaBreaches uses an atomic CAS update (WHERE slaBreachedAt IS NULL)
so only one caller wins the race and fires the breach notification. Task #173
added unit tests confirming the email IS sent on a first breach (CAS succeeds),
but there is no test confirming it is NOT sent when the CAS loses (another
process already stamped slaBreachedAt — i.e. update returns []).

Without this guard, a bug that ignored the update result would send duplicate
breach emails to assignees.

## Done looks like
- sla-detection.test.ts: "CAS race — does not call notifySlaBreached or sendMail
  when the atomic update returns an empty result (another process won the race)"
  - Mock db.update().returning() to return []
  - Confirm notifySlaBreachedSpy and sendMailSpy are not called

## Relevant files
- artifacts/api-server/src/lib/sla-detection.test.ts (new file from task #173)
- artifacts/api-server/src/lib/sla-detection.ts (line ~99 — if (updated) guard)
