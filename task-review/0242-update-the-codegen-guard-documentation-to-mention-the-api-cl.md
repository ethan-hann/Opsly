# #242 — Update the codegen guard documentation to mention the api-client-react typecheck

**State:** PROPOSED
**Depends on:** #114

---

# Update guard documentation to cover both orval outputs

## What & Why
lib/api-spec/README.md documents the two-stage codegen guard and references
the typecheck-guard.test.ts vitest test — but only mentions @workspace/api-zod.
Task #114 added a second describe block covering @workspace/api-client-react.
The README should be updated so future contributors understand that both orval
outputs (Zod schemas AND React Query hooks) are protected by the guard test.

## Done looks like
- README.md "Keeping the guard honest" section updated to reference both
  @workspace/api-zod and @workspace/api-client-react guard tests
- The table or description of Stage ④ clarifies that the typecheck covers
  hook imports from the frontend as well as server-side Zod schema imports

## Relevant files
- lib/api-spec/README.md — "Keeping the guard honest" section (lines ~36-43)
- artifacts/api-server/src/routes/typecheck-guard.test.ts — now has 2 describe blocks
