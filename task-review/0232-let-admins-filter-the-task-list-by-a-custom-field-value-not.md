# #232 — Let admins filter the task list by a custom field value, not just by field presence

**State:** PROPOSED
**Depends on:** #189

---

# Let admins filter the task list by a custom field value, not just by field presence

## What & Why
Task #189 added a `?customFieldId=<id>` filter to GET /tasks that validates org ownership
and filters tasks which have *any* value for the field. The natural next step is
`?customFieldId=<id>&customFieldValue=<value>` so admins can find tasks where a
specific field equals a specific value (e.g. "Region = APAC", "Severity = P1").

## Done looks like
- GET /tasks accepts `customFieldValue` alongside `customFieldId`
- The WHERE clause uses a JSONB containment or equality check scoped to the field type
  (text → exact match, single_select → exact match, number → numeric comparison)
- Isolation: customFieldValue is ignored when customFieldId is absent or invalid
- Unit tests cover: text match, single_select match, value absent → empty list
- The frontend task filter bar exposes the new param (optional — could be a separate task)

## Relevant files
- `artifacts/api-server/src/routes/tasks.ts` — extend the customFieldId block (line ~410)
- `artifacts/api-server/src/routes/isolation.test.ts` — extend custom field isolation tests
- `artifacts/it-task-manager/src/pages/tasks.tsx` — frontend filter bar
