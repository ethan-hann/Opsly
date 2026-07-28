<!--
Keep this short. The point is the checklist — CI enforces most of it, but tick
the boxes so reviewers know you didn't skip anything.
-->

## What & why

<!-- One or two sentences: what this changes and the reason. -->

Closes #<!-- issue number — Opsly is issue-first; PRs without an accepted issue may be closed -->

## Testing

- [ ] Added or updated tests for the new/changed behavior (not "later")
- [ ] `pnpm --filter <pkg> run test:coverage` passes locally for touched packages
- [ ] If I added an export to a shared module tests mock (`lib/sse`, `@workspace/api-client-react`, …), the mocks still cover it (spread `importOriginal`) — see `.agents/memory/test-mock-resilience.md`
- [ ] If I changed the API surface (`lib/api-spec/openapi.yaml`), I ran `pnpm --filter @workspace/api-spec run codegen` before typechecking
- [ ] If I changed the Drizzle schema, I noted the required `push-force` / post-merge steps

## Legal

- [ ] My commits are signed off (`git commit -s`, Developer Certificate of Origin)
- [ ] I agree to the [Contributor License Agreement](https://github.com/ethan-hann/Opsly/blob/main/CLA.md) and my contribution is my own work

## Notes for the reviewer

<!-- Anything out of scope, follow-ups, or DB-dependent behavior not verified in CI. -->
