# #211 — Show status, priority, and assignee changes in the dashboard activity feed

**State:** PROPOSED
**Depends on:** #197

---

# Show status, priority, and assignee changes in the dashboard activity feed

## What & Why
The dashboard activity feed now includes custom-field changes (cf: events), but standard task field changes — status transitions, priority escalations, reassignments — are also stored in task_events and are equally valuable for situational awareness. Currently those events are only visible on the individual task detail page's history tab.

## Done looks like
- GET /api/dashboard/activity fetches recent task_events rows where field IN ('status','priority','assignee','category','title','dueDate','projectId'), in addition to the existing cf: query
- Each event is formatted using the same eventDescription logic (e.g. "Status changed from To Do → In Progress on 'Deploy v2'")
- type is "field_updated" (same as cf: events), entityId/entityType point to the task
- dashboard.test.ts covers the new event types with shape and description assertions

## Relevant files
- artifacts/api-server/src/routes/dashboard.ts — activity handler (cfEventDescription helper already in place; extend to cover standard fields)
- artifacts/api-server/src/routes/dashboard.test.ts — test helper and assertions
