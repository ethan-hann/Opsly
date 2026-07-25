# #383 — Fix broken edit-task-modal tests so the full suite runs clean

**State:** PROPOSED
**Depends on:** #374

---

# Fix broken edit-task-modal tests so the full suite runs clean

## What & Why
Two tests in edit-task-modal.test.tsx currently fail with "useTerminology must be used within TerminologyProvider". This blocks a clean test suite run and may hide regressions in that modal's permission gating behaviour.

## Done looks like
- All tests in src/components/ui/edit-task-modal.test.tsx pass
- The root cause (missing TerminologyProvider wrapper in the test render helper) is resolved using either a mock or a real provider
- pnpm --filter @workspace/it-task-manager test exits with 0 failures

## Relevant files
- artifacts/it-task-manager/src/components/ui/edit-task-modal.test.tsx
- artifacts/it-task-manager/src/context/terminology-context.tsx
