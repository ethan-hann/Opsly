# #460 — Prevent the reference picker from showing stale results when switching orgs

**State:** PROPOSED
**Depends on:** #453

---

# Prevent the reference picker from showing stale results when switching orgs

## What & Why
The `useGetReferences` hook uses a `staleTime` of 5 seconds and a static query key (`["getReferences", type, query]`). If a user switches orgs (or if the reference endpoint is called across org contexts), the cached results from the previous org could briefly display in the picker before a fresh fetch completes.

## Done looks like
- The reference picker query key includes the current `orgId` (available via the org context) so React Query treats org switches as cache misses
- Or: the staleTime is set to 0 for org-sensitive queries, matching the pattern used elsewhere in the app for org-scoped data
- A test confirms that changing org context triggers a fresh fetch

## Relevant files
- `artifacts/it-task-manager/src/components/notes/markdown-editor.tsx` (useGetReferences call)
- `artifacts/it-task-manager/src/components/notes/reference-picker.tsx` (useGetReferences call)
- `artifacts/it-task-manager/src/hooks/use-org-context.ts` (orgId hook)
