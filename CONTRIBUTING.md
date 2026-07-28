# Contributing to Opsly

Thanks for your interest in Opsly. This project is **source-available**, not
open source: the code is public so you can read it, self-host it, and propose
improvements, but it is licensed under the [Functional Source License](LICENSE)
(FSL-1.1-ALv2) and the maintainer retains the commercial rights described there.
Please read this whole document before opening an issue or a pull request — the
bar for contributions is deliberately high, and PRs that skip these steps will
be closed rather than fixed up in review.

## Ground rules

- **Open an issue first.** We do **not** accept unsolicited large pull requests.
  For anything beyond a small, obvious fix (typo, broken link, one-line bug),
  file an issue describing the problem or proposal and wait for a maintainer to
  agree on the approach. Work started without an accepted issue may be declined
  regardless of quality.
- **One concern per PR.** Keep the diff minimal, reviewable, and scoped to the
  issue it closes. Don't refactor or "clean up" adjacent code that isn't part of
  the change — see the "Out of Scope" discipline in
  [`.github/copilot-instructions.md`](.github/copilot-instructions.md).
- **Match the surrounding code.** Follow existing patterns over inventing a
  parallel one. American English everywhere — UI strings, comments, identifiers,
  and tests (organization, color, behavior, canceled, center).

## Legal: DCO + CLA (required)

Two things gate every contribution. Both exist so the project can stay
source-available today and still be offered commercially — including under a
separate commercial license — without having to track down past contributors.

1. **Developer Certificate of Origin (DCO).** Every commit must be signed off,
   certifying you have the right to submit it under the project license. Add the
   trailer automatically with:

   ```bash
   git commit -s -m "your message"
   ```

   This appends `Signed-off-by: Your Name <your@email>` using your
   `git config user.name` / `user.email`. Commits without a valid sign-off will
   be rejected. The full DCO text is at <https://developercertificate.org/>.

2. **Contributor License Agreement (CLA).** By opening a pull request you agree
   to the terms in [`CLA.md`](CLA.md), which grant the maintainer a broad license
   to your contribution (including the right to relicense it commercially). You
   keep the copyright to your own work; the CLA is a license, not an assignment.
   First-time contributors will be asked to confirm agreement on their first PR.

## Development setup

Opsly is a pnpm monorepo (Node 24). Full instructions are in
[`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md); the short version:

```bash
pnpm install
docker compose -f docker-compose.local.yml up db -d
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/opsly"
pnpm run setup   # push schema + seed admin@example.com / changeme
pnpm run dev     # api-server + frontend
```

Self-hosting a full deployment is documented separately in
[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Project standards — read before writing code

The hard-won conventions live in **[`.agents/memory/`](.agents/memory/)**, indexed
by [`.agents/memory/MEMORY.md`](.agents/memory/MEMORY.md). Read the index first,
then open the notes relevant to what you're touching.
[`.github/copilot-instructions.md`](.github/copilot-instructions.md) summarizes the
repo layout and the rules that always apply. The non-negotiable ones:

- **Validation uses `@workspace/api-zod`**, never raw inline `zod` schemas.
- **Generated code is a pipeline.** `lib/api-zod` and `lib/api-client-react` are
  generated from `lib/api-spec/openapi.yaml`. If you change the API surface, edit
  `openapi.yaml` and run the codegen sync before you typecheck:

  ```bash
  pnpm --filter @workspace/api-spec run codegen
  ```

- **Schema changes** require a `drizzle push` + api-server rebuild before new
  routes work; note any manual backfill/post-merge steps in your PR.
- **Never weaken the supply-chain guard** (`minimumReleaseAge` in
  `pnpm-workspace.yaml`).

## Tests are part of the change, not a follow-up

New or changed behavior ships with tests **in the same PR**. `api-server` and
`it-task-manager` enforce a per-package coverage floor in `vitest.config.ts`; CI
fails the build if coverage drops below it.

```bash
pnpm --filter <pkg> run test:coverage   # e.g. @workspace/api-server
pnpm typecheck                          # workspace typecheck
pnpm build                              # typecheck + build all packages
```

CI (`.github/workflows/ci.yml`) runs typecheck, codegen-drift check, build, a
boot smoke test, unit tests with the coverage gate, and the DB integration suite
against a live Postgres. **A PR merges only when CI is green.**

## Pull request process

1. Fork the repo and create a branch off `main`.
2. Make your change with signed-off commits (`git commit -s`). Prefer
   conventional-commit-style subjects (`fix:`, `feat:`, `chore(scope):`).
3. Fill out the [PR template](.github/pull_request_template.md) checklist
   honestly — reviewers rely on it.
4. Ensure CI passes. Address review feedback by pushing follow-up commits (we
   squash on merge).
5. A maintainer (see [`.github/CODEOWNERS`](.github/CODEOWNERS)) reviews and
   merges. Direct pushes to `main` are blocked by branch protection.

## Reporting security issues

**Do not** open a public issue for a vulnerability. Follow
[`SECURITY.md`](SECURITY.md) instead.
