# #265 — Notify an owner when their role-deletion action downgrades other members

**State:** PROPOSED
**Depends on:** #152

---

# Show owners a confirmation when deleting a role would downgrade members

## What & Why
Owners currently get no warning before deleting a role that has active members.
They fire a silent DELETE and affected members silently lose permissions. Adding
a confirmation dialog that names the number of affected members gives owners
informed consent and reduces accidental permission loss.

## Done looks like
- Before confirming the delete in the role management UI, check if the role has
  members (the member count is available from the role list or a lightweight endpoint)
- If members > 0, show a modal: "Deleting this role will move N members to the
  Member role. Continue?" with Cancel / Delete buttons
- Only then call DELETE /roles/:id

## Relevant files
- artifacts/it-task-manager/src/pages/org-settings.tsx — role management UI
- artifacts/api-server/src/routes/roles.ts — DELETE handler (can return member
  count in a 409 pre-flight, or expose count via GET /roles/:id)
