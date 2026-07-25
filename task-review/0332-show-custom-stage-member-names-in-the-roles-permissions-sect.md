# #332 — Show custom stage/member names in the Roles & permissions section labels

**State:** PROPOSED
**Depends on:** #301

---

# Show custom terminology in Roles & permissions section labels

## What & Why
Inside the Roles & permissions card, the permission group labels are hardcoded: the "Workflow stages" permission group still says "Workflow stages" even when an org has renamed stages. The "Manage members" permission label also uses a hardcoded string. These labels appear as section headings inside each role card and in the permission summary table.

## Done looks like
- The "Workflow stages" permission group label uses `t("stages")` or the compound form
- "Manage members" permission label uses `t("members")`
- Other permission labels that reference the five term keys are updated

## Relevant files
- `artifacts/it-task-manager/src/pages/org-settings.tsx` — `PERMISSION_GROUP_LABELS` or equivalent constant (~line 1102–1128), `RoleCard` component
