# #272 — Confirm gated features are truly inaccessible when disabled — not just hidden from the UI

**State:** PROPOSED
**Depends on:** #181

---

# Confirm gated features are truly inaccessible when disabled — not just hidden from the UI

## What & Why
The feature flag UI gating (Task #181) hides sidebar links, settings cards, SLA badges, and custom-field rows when a feature is disabled. But no automated test verifies this end-to-end — a regression could re-expose gated content without anyone noticing.

## Done looks like
- A test in `artifacts/it-task-manager/src/pages/org-settings.test.tsx` renders OrgSettings with each feature disabled and asserts the corresponding card is absent
- A test covers the task-detail page: when `sla_tracking` is disabled, SlaBadge is absent; when `custom_fields` is disabled, the custom-field rows are absent
- A test covers the tasks list: when `sla_tracking` is disabled, the "SLA Breached" filter toggle is absent
- Tests use a lightweight OrgContext provider wrapper that can set arbitrary feature states

## Relevant files
- `artifacts/it-task-manager/src/components/ui/feature-gate.tsx`
- `artifacts/it-task-manager/src/pages/org-settings.tsx`
- `artifacts/it-task-manager/src/pages/task-detail.test.tsx` (existing test to extend)
- `artifacts/it-task-manager/src/hooks/use-org-context.tsx`
