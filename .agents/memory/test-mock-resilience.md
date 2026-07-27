---
name: Test coverage gate and resilient mocks
description: CI enforces per-package coverage floors; mock shared modules with importOriginal spread so new exports never silently break tests.
---

# Test coverage gate and resilient mocks

## Coverage gate
`artifacts/api-server` and `artifacts/it-task-manager` run vitest with
`@vitest/coverage-v8` and a **per-package coverage floor** set in each
`vitest.config.ts` (`test.coverage.thresholds`). CI runs
`pnpm -r --if-present run test:coverage`; if coverage drops below the floor the
build fails. This is what forces new/changed code to ship with tests.

**How to apply:** add tests in the same diff as the behavior change. Run
`pnpm --filter <pkg> run test:coverage` locally before pushing. The floors are
deliberately a few points below current and meant to be **ratcheted up** as
coverage grows — raise them, never lower them to make a red build pass. Coverage
output (`coverage/`) is gitignored.

## Resilient mocks — spread the real module
When a test mocks a shared module, spread the real module via `importOriginal`
and override only what the test controls. Adding an export to that module then
never breaks the mock with "No export defined on the mock" / a thrown call.

```ts
// api-server: side-effecting emitters stubbed, everything else real
vi.mock("../lib/sse", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sse")>()),
  pushEvent: vi.fn(),
  broadcastToOrg: vi.fn(),
}));

// frontend: real query-key generators kept, hooks overridden with fixtures
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetTask: () => ({ data: MOCK_TASK, isLoading: false }),
  // ...other hook overrides...
}));
```

**Why:** two CI outages came from exactly this — the org-wide SSE change added
`broadcastToOrg` to `lib/sse`, and explicit `getXxxQueryKey()` calls were added
to pages; the hand-written mocks (`../lib/sse`, `@workspace/api-client-react`)
listed only a subset of exports, so the new export was missing and the handler
500'd / the page render threw. Spreading `importOriginal` makes the pure exports
(query-key generators) and any future export always present. Override hooks
(which would otherwise fetch) and side-effecting functions; leave pure helpers
real. See [[orval-codegen-command]] for why the generators exist.
