---
name: Terminology system
description: How the org terminology alias system works in the frontend, and the rules for adding new components.
---

# Org Terminology System

## Architecture
- Five plural TermKeys: `projects`, `tasks`, `members`, `workflows`, `stages`
- `TerminologyProvider` in `artifacts/it-task-manager/src/context/terminology-context.tsx` reads the `terminology` field from the cached `/orgs/me` response (no extra fetch)
- `useTerminology()` exposes `t(key)` (plural) and `tSingular(key)` (auto-derived: strips trailing 's', handles 'ies'→'y')
- `GlobalSearchPalette` must live INSIDE `TerminologyProvider` — it was moved to `OrgAwareApp` in `App.tsx` for this reason

## Provider placement
```
QueryClientProvider
  GlobalSearchProvider
    OrgAwareApp (= OrgGuard > TerminologyProvider)
      Router          ← authenticated pages
      GlobalSearchPalette  ← needs to be inside TerminologyProvider
```

## Rule for future components
Any component that renders user-visible terminology words must call `useTerminology()` and use `t(key)` / `tSingular(key)`. Never hardcode "Projects", "Tasks", "Members", "Workflows", or "Stages" in JSX. Module-level string constants that include these words must be converted to factory functions that accept `t` and `tSingular`.

**Why:** The org can alias these words (e.g. Projects → Epics, Tasks → Tickets, Members → Staff). Hardcoded strings break the aliasing silently with no TypeScript warning.

**How to apply:** When adding any new page, modal, or component: import `useTerminology`, destructure `t` and/or `tSingular`, replace all five terminology words in JSX.
