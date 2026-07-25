# #331 — Extend terminology to org settings card descriptions so renamed terms appear consistently

**State:** PROPOSED
**Depends on:** #301

---

# Extend terminology to org settings card descriptions

## What & Why
The card *titles* in org-settings now use custom terminology, but the description text beneath them still has hardcoded English. For example, the Workflow Stages card says "Define the stages tasks move through" — if an org renames stages to "Steps" and tasks to "Tickets", the description stays inconsistent. Fixing the descriptions completes the terminology substitution inside org settings.

## Done looks like
- WorkflowStagesCard CardDescription uses `t("stages")` and `t("tasks")` in its prose
- TaskTemplatesCard CardDescription uses `tSingular("tasks")` and `t("members")` where they appear
- Any other setting-card descriptions that reference the five terminology keys are updated

## Relevant files
- `artifacts/it-task-manager/src/pages/org-settings.tsx` — WorkflowStagesCard (~line 1835), TaskTemplatesCard (~line 2038)
