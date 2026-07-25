# #212 — Confirm the task history view gracefully handles cf: events for fields that have since been purged

**State:** PROPOSED
**Depends on:** #198

---

# Confirm the task history view handles cf: events for purged custom fields

## What & Why
Renaming a custom field leaves pre-existing task_events intact with the original name — confirmed. But purging a field (hard-delete via POST /custom-fields/:id/purge) removes the definition row entirely. Older task_events still reference "cf:FieldName" in their `field` column. The task detail history tab uses `eventDescription(field, oldValue, newValue)` which calls `field.slice(3)` and renders whatever name is stored — so the event renders correctly even if the definition is gone. This should be confirmed with a unit test of `eventDescription` for purged-field scenarios, and optionally a note in the purge handler confirming that task_events rows are intentionally left in place.

## Done looks like
- A unit test (or inline assertion in custom-fields.test.ts) confirms POST /custom-fields/:id/purge does NOT delete task_events rows for the purged field
- A comment in the purge handler documents that task_events rows are intentionally retained so the audit trail remains intact after a purge
- Optionally: a frontend unit test of eventDescription('cf:DeletedField', 'val', null) confirming it renders "DeletedField cleared (was val)"

## Relevant files
- artifacts/api-server/src/routes/custom-fields.ts — purge handler (POST /custom-fields/:id/purge)
- artifacts/api-server/src/routes/custom-fields.test.ts — purge describe block
- artifacts/it-task-manager/src/pages/task-detail.tsx — eventDescription() reference
