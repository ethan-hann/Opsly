# #422 — Fix query hygiene, 403 floods, retry storms, and close server-side permission gaps

> **Order:** This is the foundational task. Merge it **before** #425 and #462 — both
> depend on the `query-client.ts` changes made here.

## Problem / Goal

The Opsly frontend floods the network and console with avoidable requests:
feature/permission-gated queries fire for users who lack the feature/permission,
each failing 403 is retried 3×, then re-fired on the 8 s poll; `staleTime: 0`
re-fetches stable data on every mount/focus; and an inline `= []` default triggers
an infinite render loop that crashes the Custom Fields tab. Behind the noise sit
real server-side gaps: some mutating endpoints that are API-key-accessible enforce
their permission **only** for API keys, not for session users. This task fixes the
client hygiene issues and closes those server gaps.

## Scope

**Client**
- Fix the `CustomFieldsManager` infinite re-render loop (stable empty-array default).
- Add `enabled` guards so gated queries don't fire (and 403) for users lacking the feature/permission: invitations, SLA policies + summary, workflow stages, webhooks, audit log, SLA audit history, API keys.
- Global React Query: don't retry 4xx errors; raise `staleTime` 0 → 30 s. **Leave `refetchInterval: 8_000` alone** (that's #425).

**Server — extend session-side permission gating across the API**
The root issue: `requireScope(...)` is a **no-op for session users** — it only gates
API keys. So any mutating route protected *only* by `requireScope` lets **any** org
member (including a `Member` role) perform the action via the session UI/API. The
correct idiom (already used by `tasks.ts` and `comments.ts`) is an in-handler
`hasPermission(req, <key>)` check, which returns `true` for API keys (already
scope-gated) and consults the role map for sessions.
- **`projects.ts`** — `POST/PATCH/DELETE /projects` gain a session `manage_projects` gate (in-handler `hasPermission`, because these are API-key-accessible).
- **`webhooks.ts`** — all inbound/outbound mutations gain a session `manage_webhooks` gate (in-handler `hasPermission`, API-key-accessible).
- **`custom-fields.ts`** — the six mutation routes currently gate on `requireAdmin` (which checks `manage_projects`), the wrong permission; switch them to `requirePermission("manage_custom_fields")`. These are session-only (`requireOrg`), so the middleware form is correct here.
- **`GET /dashboard/sla-summary`** — add the `sla_tracking` feature gate (server gap B).

**Not in scope:** changing `refetchInterval` (#425), notes/SSE work, perf work (#462),
and — importantly — re-gating routes that are **already** correctly gated (see Risks #3).

## User Stories

- As a **Member on an org with SLA / custom-statuses / webhooks disabled**, I browse the dashboard, task list, task detail, project detail, and webhooks pages with **zero** 403s in the Network tab.
- As **any user**, the Custom Fields tab opens without "Maximum update depth exceeded".
- As a **non-admin session user**, I cannot create/rename/delete projects or create/edit/delete webhooks — the server returns 403 even if I bypass the UI.
- As an **API-key integration** with `projects:write` / `webhooks:write`, my access is unchanged (still scope-gated).
- As a **user**, a 4xx error surfaces immediately (no 3× retry), and stable data (roles, stages, templates, custom fields) is not re-fetched on every mount/focus.
- As an **org without `sla_tracking`**, `GET /dashboard/sla-summary` returns 403 like every other SLA endpoint.

## Open Questions / Risks

1. **`requirePermission` middleware is fail-closed for API keys — do NOT use it on these routes.**
   `requirePermission(...)` ([requireOrgMiddleware.ts:163](artifacts/api-server/src/middlewares/requireOrgMiddleware.ts:163)) returns 403 for *every* API-key request. `projects` and `webhooks` mutations are deliberately API-key-accessible via `requireScope`. Adding that middleware would break all API-key integrations. Use the in-handler `hasPermission(req, key)` helper ([requireOrgMiddleware.ts:209](artifacts/api-server/src/middlewares/requireOrgMiddleware.ts:209)) instead — it returns `true` for API keys and checks the role map for sessions. **Flagging for Ethan** in case the intent was actually to make these routes session-only.

2. **The full API audit — only `projects` and `webhooks` are real holes.** I checked every mutating route. Result:
   - **Holes (fix here):** `projects.ts` mutations, `webhooks.ts` mutations (imports `hasPermission` but never calls it — mutations rely on `requireScope` alone).
   - **Wrong permission (fix here):** `custom-fields.ts` mutations gate on `requireAdmin` (`manage_projects`) instead of `manage_custom_fields` — blocks Members so it's not an escalation, but a custom role granted `manage_custom_fields` yet denied `manage_projects` can't manage fields, and vice-versa. Switch to `requirePermission("manage_custom_fields")`.
   - **Already gated in-handler (leave alone):** `tasks.ts` (create/edit/close/delete, incl. the `close_tasks` special case), `comments.ts` (edit/delete via owner-OR-`hasPermission`), `saved-views.ts` (owner-OR-`manage_saved_views`).
   - **Already gated by middleware (leave alone):** `workflow-stages.ts` (`manage_workflow_stages`), `task-dependencies.ts` (`link_tasks`), `api-keys.ts` (`manage_api_keys`), `task-templates.ts` (`manage_task_templates`), `orgs.ts` (per-route `requirePermission`), `roles.ts` (`requireOwner`), `export.ts` (`manage_org_settings`).
   - **Intentionally open (leave alone):** `notes.ts` and `notifications.ts` (personal/shared, in-handler ownership; no admin permission applies), comment creation + reactions (base capabilities, no matching permission).

3. **Do not double-gate the already-correct routes.** Adding a second gate to `tasks`/`comments`/`saved-views` risks breaking the nuanced logic they already implement (e.g. a Member closing their own task, or editing their own comment). The Codex prompt lists these as explicitly out of scope.

4. **Two gating idioms — pick by whether the route is API-key-accessible.** `projects`/`webhooks` use `requireScope` (API-key path), so they need the in-handler `hasPermission(req, key)` check (returns `true` for keys). `custom-fields` uses `requireOrg` (session-only, keys already rejected), so it takes the simpler `requirePermission(key)` middleware. The Codex prompt calls out which to use where so the two don't get crossed.

5. **No schema changes.** Standard post-merge `push-force` + api-server rebuild still applies because routes change; no migration.
