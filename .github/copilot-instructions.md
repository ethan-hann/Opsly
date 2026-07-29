# Copilot instructions for Opsly

**Read [`AGENTS.md`](../AGENTS.md) at the repo root first — it is the canonical,
tool-neutral guide** to Opsly's layout, standards (`.agents/memory/`), skills
(`.agents/skills/`), commands, and workflow expectations. Everything that applies to
all agents lives there and is not repeated here. This file adds only what is specific
to the GitHub Copilot coding-agent sandbox.

When implementing a planned feature from a GitHub issue, follow the workflow in
[`.github/agents/opsly-plan-executor.agent.md`](agents/opsly-plan-executor.agent.md).

## Copilot sandbox: bootstrap before you verify

`.github/workflows/copilot-setup-steps.yml` puts Node 24 and `pnpm` on PATH — it does
**not** run `pnpm install`, so run that yourself before typecheck/build/test. If a run
lands without `pnpm`, install it with `npm install -g pnpm@10.34.5` — do **not** use
`corepack` (its signature check fails in the sandbox). There is **no database** by
default, so DB integration suites auto-skip; a green run is not proof they passed.

Bootstrap and run the checks rather than reporting them as impossible.
