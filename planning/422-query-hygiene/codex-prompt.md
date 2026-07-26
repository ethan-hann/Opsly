# Codex Prompt — #422 Query hygiene, 403 floods, retry storms, server-side permission gaps

## Task

Fix a set of frontend query-hygiene problems in the Opsly `it-task-manager` app and
close two categories of server-side permission/feature gaps in `api-server`. This is
the first of three related changes and **must merge before** the SSE task (#425) and
the query-performance task (#462); both build on the `query-client.ts` edits here.

There are two guardrails that override the naive reading of some steps — read them first.

## Critical Guardrails

### G1 — Gate `projects` and `webhooks` mutations for SESSION users only; do NOT use `requirePermission` middleware

`requirePermission(key)` in `artifacts/api-server/src/middlewares/requireOrgMiddleware.ts`
is **fail-closed for API keys** — it returns 403 for every API-key request. The
`projects` and `webhooks` mutation routes are intentionally API-key-accessible via
`requireScope(...)`, and `requireScope` is a **no-op for session users** (it only
gates API keys). So the fix is an **in-handler** check using the existing helper from
that same middleware module:

```ts
export function hasPermission(req: Request, key: PermissionKey): boolean {
  if (req.apiKeyId) return true;            // API keys are already scope-gated
  return req.orgPermissions?.[key] ?? false; // sessions consult the role map
}
```

Add, as the first statement inside each target handler (after the existing middleware
chain runs):

```ts
if (!hasPermission(req, "<permission_key>")) {
  res.status(403).json({ error: "Permission required: <permission_key>" });
  return;
}
```

This is the exact idiom already used in `tasks.ts` and `comments.ts`. Do **not** add
`requirePermission(...)` middleware to these routes, and do **not** alter the existing
`requireOrgOrApiKey` / `requireScope(...)` / `requireWebhooksFeature` chain.

**Why in-handler and not middleware here:** `requirePermission` middleware rejects all
API keys, and these routes are API-key-accessible. The **only** route in this task
that takes `requirePermission` middleware is `custom-fields` (Step 14) — it uses
`requireOrg` (session-only, keys already rejected), so the middleware form is correct
there. Pick the idiom by whether the route is API-key-accessible; don't cross them.

### G2 — Do NOT re-gate routes that are already gated

Only `projects.ts` and `webhooks.ts` mutations lack session-side enforcement. Every
other mutating route is already correctly gated (see "Out of Scope"). Do not add any
permission check to them — several implement nuanced logic (owner-vs-admin,
close-vs-edit) that a blanket gate would break.

---

## Steps

### Client — fix the render loop
1. `artifacts/it-task-manager/src/components/ui/custom-fields-manager.tsx` (~line 544): the hook `useListCustomFieldDefinitions({ includeSoftDeleted: true })` uses an inline `data: allFields = []` default, so `allFields` is a fresh array each pending render and the `useEffect(() => setFields(serverFields), [allFields])` loops ("Maximum update depth exceeded"). Add a module-level `const EMPTY_FIELDS: CustomFieldDefinition[] = [];` and change the destructure to `data: allFields = EMPTY_FIELDS`.

### Client — `enabled` guards
Use `hasPermission(...)` / `isFeatureEnabled(...)` from `useOrgContext()` (defined in `artifacts/it-task-manager/src/hooks/org-guard.tsx`, consumed via `use-org-context`). Add `{ query: { enabled: <cond> } }` to each call. Feature-off cases keep their existing `= []` default, so an empty result renders fine.

2. `useListOrgInvitations` in `pages/org-settings.tsx` (root `OrgSettings`) → `enabled: hasPermission("manage_members")`. Keep the existing `refetch: refetchInvitations` binding.
3. `useGetSLAPolicies` in `pages/dashboard.tsx`, `pages/tasks.tsx`, `pages/project-detail.tsx`, `pages/task-detail.tsx` → `enabled: isFeatureEnabled("sla_tracking")`.
4. `useGetDashboardSlaSummary` in `pages/dashboard.tsx` → `enabled: isFeatureEnabled("sla_tracking")`.
5. `useListWorkflowStages` in `pages/task-detail.tsx`, `pages/tasks.tsx`, `pages/project-detail.tsx`, `components/ui/new-task-modal.tsx`, `components/ui/edit-task-modal.tsx` → `enabled: isFeatureEnabled("custom_statuses")`.
6. `useListInboundWebhooks` / `useListOutboundWebhooks` in `pages/webhooks.tsx`, `pages/webhook-inbound-edit.tsx`, `pages/webhook-outbound-edit.tsx` → `enabled: isFeatureEnabled("webhooks")`.
7. `useGetOrgAuditLog` in `pages/audit-log.tsx` → `enabled: hasPermission("view_audit_log")`.
8. `useSlaAuditHistory` raw fetch in `pages/project-detail.tsx` → only run when `hasPermission("view_audit_log") || hasPermission("manage_sla_policies")` (add `enabled` to the `useQuery`, or early-return `undefined` before it).
9. `useListApiKeys` in the `ApiKeysCard` inside `pages/org-settings.tsx` → `enabled: isOwner`.

### Client — global query-client
`artifacts/it-task-manager/src/lib/query-client.ts` (`defaultOptions.queries`):
10. Add a `retry` function: return `false` when the error's `.status` is 400–499 inclusive; otherwise `failureCount < 3`. The error is an `ApiError` (from `lib/api-client-react/src/custom-fetch.ts`) exposing `.status`; guard against an undefined status.
11. Change `staleTime` from `0` to `30_000`. **Leave `refetchInterval: 8_000` unchanged** (#425 changes it later).

### Server — close permission/feature gaps
12. **`projects.ts`** — Per **G1**, add the in-handler `hasPermission(req, "manage_projects")` 403 guard to the `POST /projects`, `PATCH /projects/:id`, and `DELETE /projects/:id` handlers. Import `hasPermission` from `../middlewares/requireOrgMiddleware` (same module the file already imports `requireOrgOrApiKey`/`requireScope` from). Leave the read routes untouched.
13. **`webhooks.ts`** — Per **G1**, add the in-handler `hasPermission(req, "manage_webhooks")` 403 guard to every webhook **mutation** handler: `POST/PATCH/DELETE /webhooks/inbound`, `POST /webhooks/inbound/:id/rotate-secret`, `POST /webhooks/inbound/test`, `POST/PATCH/DELETE /webhooks/outbound`, `POST /webhooks/outbound/test`. The file already imports `hasPermission` (line ~34) but never calls it. Do **not** touch the public `POST /webhooks/inbound/:token/ingest` route (token-authenticated) or any `GET`/list handler.
14. **`custom-fields.ts`** — The six **mutation** routes (`POST /custom-fields`, `PATCH /custom-fields/:id`, `DELETE /custom-fields/:id`, `POST /custom-fields/:id/restore`, `POST /custom-fields/:id/purge`, `POST /custom-fields/reorder`) gate on `requireAdmin`, which checks `manage_projects` — the wrong permission. Replace `requireAdmin` with `requirePermission("manage_custom_fields")` in each of those six middleware chains (keep `requireOrg` and `requireCustomFieldsFeature` as-is). Update the import on line 18 from `requireAdmin` to `requirePermission` (remove `requireAdmin` if it's no longer referenced). **Do not** add any gate to `GET /custom-fields` (line 45) — the list must stay readable by all org members. Use the `requirePermission` **middleware** here (not the in-handler `hasPermission` form) because these routes are session-only (`requireOrg` already rejects API keys).
15. **`dashboard.ts`** — `GET /dashboard/sla-summary` (~line 254) currently uses only `requireOrg`. Add a `sla_tracking` feature gate to match the other SLA endpoints: `const requireSlaTrackingFeature = requireOrgFeature("sla_tracking");` and insert it into that route's middleware chain. Follow the exact pattern in `routes/orgs.ts`; import `requireOrgFeature` from `../lib/org-features` (verify the export/path against `orgs.ts`). Do not touch `/dashboard/summary` or `/dashboard/activity`.

## Acceptance Criteria

- Custom Fields tab opens with no "Maximum update depth exceeded".
- On an org with `sla_tracking` / `custom_statuses` / `webhooks` disabled, the Network tab shows **no** 403s from dashboard, task list, task detail, project detail, or webhooks pages.
- A non-admin **session** user gets 403 on project create/rename/delete and on any webhook mutation, even via direct API call; an API key with the matching write scope still succeeds.
- Custom-field mutations require `manage_custom_fields` (not `manage_projects`); a role with `manage_custom_fields` can manage fields regardless of its `manage_projects` value, and `GET /custom-fields` remains readable by all members.
- Any 4xx response is not retried; the error surfaces immediately.
- Stable data (roles, stages, templates, custom fields) is not re-fetched every mount/focus.
- `GET /dashboard/sla-summary` returns 403 for orgs without `sla_tracking`.
- Admin and Owner users are unaffected.

## Relevant Files / Paths

- `artifacts/it-task-manager/src/components/ui/custom-fields-manager.tsx`
- `artifacts/it-task-manager/src/pages/{org-settings,dashboard,tasks,task-detail,project-detail,audit-log,webhooks,webhook-inbound-edit,webhook-outbound-edit}.tsx`
- `artifacts/it-task-manager/src/components/ui/{new-task-modal,edit-task-modal}.tsx`
- `artifacts/it-task-manager/src/lib/query-client.ts`
- `artifacts/it-task-manager/src/hooks/org-guard.tsx` (source of `hasPermission` / `isFeatureEnabled` / `isOwner` via `use-org-context`)
- `lib/api-client-react/src/custom-fetch.ts` (`ApiError.status`)
- `artifacts/api-server/src/routes/{projects,webhooks,custom-fields,dashboard}.ts`
- `artifacts/api-server/src/middlewares/requireOrgMiddleware.ts` (`hasPermission`)
- `artifacts/api-server/src/lib/org-features.ts` (`requireOrgFeature`); pattern reference in `routes/orgs.ts`

## Standards to Follow (from `.agents/`)

- **American spellings** — American English in all UI strings, comments, names, and test descriptions (color, behavior, organization, canceled, gray, authorize…).
- **api-server imports zod schemas from `@workspace/api-zod`, never raw `zod`/`zod/v4`.** No new packages should be needed; if you find you need one, add it to `artifacts/api-server/package.json` (esbuild resolves from the package's own node_modules) and flag it.
- **Post-merge** — the pipeline runs `pnpm install --frozen-lockfile`, `pnpm --filter @workspace/db run push-force`, `pnpm --filter @workspace/api-server run build`. No schema change here (no migration); the api-server workflow must restart to pick up the route changes.

## Out of Scope — do NOT change

- Do **not** add `requirePermission(...)` middleware to `projects` or `webhooks` (Guardrail G1) — use the in-handler `hasPermission(req, …)` check.
- Do **not** change `refetchInterval` (that's #425).
- Do **not** add or change permission checks on any of these already-gated routes: `tasks.ts`, `comments.ts`, `saved-views.ts` (already in-handler owner/permission logic), and `workflow-stages.ts`, `task-dependencies.ts`, `api-keys.ts`, `task-templates.ts`, `orgs.ts`, `roles.ts`, `export.ts` (already middleware-gated). (`custom-fields.ts` **is** in scope — Step 14 — but only its six mutation routes; the `GET` stays open.)
- Do **not** gate comment creation, reactions, notes, or notifications — these are base/personal capabilities with no corresponding admin permission.
- Do **not** touch the public `POST /webhooks/inbound/:token/ingest` route.
- Do **not** touch `/dashboard/summary` or `/dashboard/activity` (the latter is #462).
