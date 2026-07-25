# #235 — Show purged custom field in task history so admins know why a value disappeared

**State:** PROPOSED
**Depends on:** #107

---

# Show purged custom field in task history so admins know why a value disappeared

## What & Why
The API now writes audit events when a custom field is purged, but the task history UI currently only renders events for standard fields (status, priority, etc.). Audit events with a "cf:" prefix will silently appear without a human-readable label or explanation, so admins reviewing a task after a purge will still see a confusing gap.

## Done looks like
- The task history / activity feed renders "cf:" events with a clear label such as "Custom field 'Environment' cleared (field deleted)"
- The old value (e.g. "prod" or ["A","B"]) is shown so the reviewer knows what was lost
- Works for both single-value and array stored values

## Relevant files
- Task history / activity feed component in `artifacts/it-task-manager/src/`
- `lib/api-client-react/src/generated/` — task events API types
