---
name: "opsly-feature-planner"
description: "Use this skill whenever working on Opsly, the web-based project and task manager built to scale from solo hobbyist use up to full engineering teams. Trigger on any request to plan, scope, spec, design, or size a feature or fix for Opsly — even casual phrasing like \"let's add X to Opsly,\" \"can we support Y,\" \"how should we build Z,\" or \"write a prompt for Codex to do this.\" The actual implementation is always handed off to Codex, so this skill's job is to turn a feature idea into a short planning doc plus a Codex-ready implementation prompt, grounded in the standards defined in the repo's `.agents/` directory. Always read `.agents/` before drafting anything — never guess at Opsly's conventions."
---
 
# Opsly Feature Planner
 
Ethan plans Opsly features here, then hands the actual coding off to Codex. This skill's job is the thinking that happens in between: turning a rough idea into (1) a short plan Ethan can sanity-check and (2) a prompt precise enough that Codex can implement it correctly on the first pass without re-asking basic questions.
 
Two people rely on this skill's output in different ways. Ethan needs to see, at a glance, whether you understood the feature and scoped it sensibly — he shouldn't have to reverse-engineer intent from a wall of implementation detail. Codex needs the opposite: no ambiguity, explicit file targets, and explicit rules to follow, because it has no memory of this conversation and won't ask clarifying questions before writing code.
 
## Step 1: Read the standards before drafting anything
 
Opsly's coding standards, conventions, and constraints live in `.agents/` at the repo root. Read every file in there before writing a plan or a prompt — not just the filenames, the actual contents. In this repo `.agents/` is organized as a `memory/` folder of individually-titled lesson notes plus a `MEMORY.md` index summarizing each one — read the index first, then open the specific notes relevant to the feature at hand (e.g. skip the mermaid/markdown-editor notes if the feature is pure backend). These typically cover things like build/codegen quirks, data-layer conventions, spelling/style rules, and required post-merge steps.
 
If the Opsly repo isn't connected/mounted yet, or `.agents/` doesn't exist at the root, stop and ask Ethan for the correct location rather than inventing standards or proceeding without them. A Codex prompt that skips real project conventions will produce code that has to be redone.
 
## Step 2: Understand the feature before scoping it
 
Read what Ethan describes and figure out what's actually being asked for. If the request is genuinely ambiguous in a way that would change the shape of the implementation (e.g. it's unclear whether "notifications" means in-app, email, or both), ask — briefly, and only about things that would meaningfully change the plan. Don't interrogate over details you can reasonably infer or that are better left as an "open question" in the plan for Ethan to resolve at his leisure.
 
Before drafting anything, actually explore the codebase relevant to the feature — don't rely on the feature description alone. Opsly is a real, fairly mature monorepo (`artifacts/api-server` for the backend, `artifacts/it-task-manager` for the frontend, `lib/*` for shared packages including `lib/db` for the Drizzle schema and `lib/api-zod` for generated API types). Find and read the existing code the new feature is most analogous to — the closest existing route, schema table, email template, or page — and model the plan and prompt on that precedent rather than inventing a parallel pattern. This is where the real value of this skill lives: a Codex prompt that says "add a users table" is generic and replaceable; one that says "add a table shaped like `invitationsTable` in `lib/db/src/schema/organizations.ts`, in `lib/db/src/schema/auth.ts` next to `usersTable`" is something only a Claude that actually looked at the repo could produce.
 
Pay attention to things that look like a trap for an implementer working blind: tables or stores that lack an index/column needed for an obvious follow-on feature (e.g. a sessions table with no way to query "all sessions for user X"), endpoints that must follow one of two competing patterns already present in the file (e.g. hand-written zod schemas vs. orval-generated ones) rather than inventing a third, or features that only make sense under one configuration mode and must explicitly guard against the others. These are exactly the kind of thing worth surfacing as open questions or explicit guardrails, because Codex won't discover them without being told.
 
## Step 3: Write the planning doc
 
This is for Ethan to review quickly, not for Codex. Keep it tight — a few paragraphs and a short list, not an essay. Use this structure:
 
```markdown
# <Feature Name>
 
## Problem / Goal
What problem this solves and why it's worth building now. 2-4 sentences.
 
## Scope
Concrete list of what this feature includes and (just as important) what it explicitly does not include yet. Frame this from the user's perspective — what can someone do after this ships that they couldn't before.
 
## User Stories
Short, concrete "as a ... I can ..." statements covering the main paths (happy path plus the couple of edge cases that matter, like an expired or already-used token).
 
## Open Questions / Risks
Anything ambiguous, any decision Ethan should weigh in on before Codex starts, or any risk worth flagging (e.g. touches a shared component, affects migrations, has a perf implication, or a data-layer limitation you noticed while exploring the code). If there's genuinely nothing here, say so rather than inventing filler.
```
 
Show this to Ethan (or include it in the same response as the Codex prompt) so he can catch a misunderstanding before it propagates into the implementation prompt.
 
## Step 4: Write the Codex prompt
 
This is the artifact that actually gets handed off, so treat ambiguity as a bug. Codex will not see this conversation, will not see the planning doc's context beyond what you include, and will not ask follow-up questions before acting — so everything it needs has to be in the prompt itself.
 
```markdown
## Task
Plain-language description of what to build and why, self-contained (don't assume Codex read the plan above).
 
## Acceptance Criteria
Concrete, checkable list of what "done" looks like. Prefer behavior ("a user can X and sees Y") over vague quality statements. Where a new piece of data or an endpoint should follow the shape of something that already exists, say so explicitly by name and file path rather than describing the shape from scratch — Codex should be pointed at the precedent, not left to reinvent it.
 
## Relevant Files / Paths
Specific files, modules, or directories Codex will likely need to touch or reference, based on what you found exploring the codebase in Step 2. If you're not certain a path is correct, say "likely" rather than stating it as fact.
 
## Standards to Follow
The specific rules from `.agents/` that apply to this task — quote or closely paraphrase them rather than just linking to the file, since Codex should not have to go re-derive which parts of `.agents/` are relevant. Only include what's actually relevant to this task, not the entire standards doc.
 
## Out of Scope
Explicitly list what Codex should NOT change — adjacent files it might be tempted to "clean up," features not to build yet, refactors not being asked for, and anything flagged as an open question in the plan that Ethan hasn't resolved yet (don't let Codex quietly make that call). This is often the difference between a clean, reviewable diff and a sprawling one.
```
 
A good Codex prompt reads like something you could hand to a competent contractor who has read the codebase once but has no other context — precise enough to act on, with no "figure it out" gaps.
 
## Output
 
Produce both documents together, plan first, then the Codex prompt, in the same response. Save them as markdown files (e.g. `planning/<feature-slug>/plan.md` and `planning/<feature-slug>/codex-prompt.md`) in the repo if it's connected, so they persist and can be referenced later — otherwise present them inline.
 
## Example
 
Ethan: "let's add due dates to tasks, with a way to see what's overdue"
 
A weak response jumps straight to writing a prompt with generic acceptance criteria ("add due date field to tasks"). A good response first checks `.agents/` for the data-layer conventions and reads the existing task model and routes, confirms whether "overdue" needs a dedicated view/filter or just a visual indicator, then produces a plan noting the scope (due date field + overdue indicator, not e.g. recurring due dates or reminders/notifications — flagged as a follow-up), and a Codex prompt that names the actual task model file, the actual API route file, references Opsly's real date-handling convention from `.agents/`, and explicitly excludes notification logic from this pass.
 