---
name: "opsly-feature-planner"
description: "Use this skill whenever working on Opsly, the web-based project and task manager built to scale from solo hobbyist use up to full engineering teams. Trigger on any request to plan, scope, spec, design, or size a feature or fix for Opsly — even casual phrasing like \"let's add X to Opsly,\" \"can we support Y,\" \"how should we build Z,\" or \"write an implementation prompt for the coding agent.\" The actual implementation is always handed off to the GitHub Copilot coding agent, so this skill's job is to turn a feature idea into a short planning doc plus an implementation prompt ready for that agent, grounded in the standards defined in the repo's `.agents/` directory. Always read `.agents/` before drafting anything — never guess at Opsly's conventions."
---

# Opsly Feature Planner

This is a thin loader so Claude Code discovers the skill on a fresh clone. **The full,
canonical workflow is the single source of truth at
[`.agents/skills/opsly-feature-planner.md`](../../../.agents/skills/opsly-feature-planner.md)**
(repo root). Read that file now and follow it exactly — do not act on this stub alone.

Keep this stub's `description` frontmatter in sync with the canonical file's; everything
else lives there.
