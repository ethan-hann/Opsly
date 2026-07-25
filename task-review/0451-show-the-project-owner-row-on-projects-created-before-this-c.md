# #451 — Show the project owner row on projects created before this change was deployed

**State:** PROPOSED
**Depends on:** #447

---

# Show the project owner row on projects created before this change was deployed

## What & Why
The `created_by` column was added to the `projects` table as nullable with `SET NULL` on user delete. All projects created before this migration will have `created_by = NULL` and will silently omit the Owner row in the Properties panel. Teams with existing projects will never see an owner.

A one-time backfill — matching projects to their `project.created` org-event entry — could populate `created_by` for historical projects where the actor is still an active org member.

## Done looks like
- A script or migration reads `org_events` where `action = 'project.created'` and `actor_id` references a current user, then writes the `actor_id` into `projects.created_by` for the matched project.
- Projects created via API key (actorId is a key ID, not a user UUID) are left as NULL.
- The Owner row appears in the Properties panel for backfilled projects.

## Relevant files
- `lib/db/src/schema/projects.ts` — `createdBy` column
- `lib/db/src/schema/org-events.ts` — `orgEventsTable` with `actorId` and `action`
- `artifacts/api-server/src/routes/projects.ts` — GET /projects/:id serialization
