# #422 — Fix query hygiene, 403 floods, and retry storms

**State:** PROPOSED
---

# Fix query hygiene, 403 floods, and retry storms

## What & Why

Several classes of problem combine to flood the browser console, waste network requests, and leave real permission holes in the server. This task addresses all of them in one pass.

---

### Bug 1 — `custom-fields-manager.tsx` infinite re-render loop

`CustomFieldsManager` still uses an inline `= []` default:

```js
const { data: allFields = [], isLoading } = useListCustomFieldDefinitions({ includeSoftDeleted: true });
useEffect(() => { setFields(serverFields); }, [allFields]);
```

While the query is pending, `data` is `undefined` so `allFields` becomes a new `[]` literal every render. React sees `allFields` change, fires the `useEffect`, calls `setFields(serverFields)` (another new array from `.filter()`), which triggers a re-render — until React's 50-render limit fires "Maximum update depth exceeded".

---

### Bug 2 — Feature-gated and permission-gated queries fire for everyone

Multiple hooks are called unconditionally from components that mount for all authenticated users. When the underlying endpoint requires a permission or feature the user lacks, the server returns 403, and with `refetchInterval: 8_000` + React Query's default `retry: 3`, each query produces **4 failed requests every 8 seconds**.

**Permission-gated endpoints hit by all users:**
- `useListOrgInvitations` in the root `OrgSettings` component fires for all members even though `GET /orgs/invitations` requires `manage_members`.

**Feature-gated endpoints hit regardless of feature state:**
- `useGetSLAPolicies` called in `dashboard.tsx`, `tasks.tsx`, `project-detail.tsx`, `task-detail.tsx` — server's `GET /org/sla-policies` returns 403 (via `requireSlaTrackingFeature`) when `sla_tracking` is disabled for the org.
- `useGetDashboardSlaSummary` called in `dashboard.tsx` — the server's `GET /dashboard/sla-summary` currently has **no** feature gate (server-side gap, see below), but the query still makes no sense to run for orgs without the SLA feature.
- `useListWorkflowStages` called in `task-detail.tsx`, `tasks.tsx`, `project-detail.tsx`, `new-task-modal.tsx`, `edit-task-modal.tsx` — server's `GET /workflow-stages` returns 403 via `requireCustomStatusesFeature` when `custom_statuses` is disabled. Five call-sites with no guard means a user viewing any task generates rapid 403 floods.
- `useListInboundWebhooks` / `useListOutboundWebhooks` called in `webhooks.tsx`, `webhook-inbound-edit.tsx`, `webhook-outbound-edit.tsx` — server requires `requireWebhooksFeature`; disabled feature means 403 for all users visiting the webhooks page.

**Defense-in-depth (component-gated but missing query-level guard):**
These hooks are inside components that only mount for permitted users today, but have no `enabled` guard at the query level — a refactor that widens the component's mounting context would silently introduce 403 floods:
- `useGetOrgAuditLog` in `AuditLogPage` (page is gated by `view_audit_log`)
- `useSlaAuditHistory` raw fetch in `ProjectDetail` (rendered conditionally but no permission check on the fetch itself)
- `useListApiKeys` in `ApiKeysCard` (card only mounts for owners)

---

### Bug 3 — All 4xx errors are retried 3 times globally

No global `retry` guard exists. Every 403, 404, and 409 triggers 3 automatic retries before React Query marks the query as failed, then retries again after `refetchInterval`. This is the multiplier that turns one wrong query into dozens of requests per minute.

---

### Bug 4 — `staleTime: 0` causes redundant refetches on every mount and focus

With `staleTime: 0` every cached result is immediately stale. Component mounts and window-focus events trigger background refetches for all active queries, even for stable data (roles, stages, templates) that hasn't changed. Raising the default `staleTime` to 30 s eliminates these no-op round-trips and is a prerequisite for the `refetchInterval` increase in Task #425.

---

### Server-side gap A — Project mutations have no permission gate

`POST /projects`, `PATCH /projects/:id`, and `DELETE /projects/:id` use only `requireOrgOrApiKey` + `requireScope("projects:write")`. Any authenticated org member can create, rename, and delete projects — even though `manage_projects` is the permission that defines admin status and the client hides these actions from non-admins. The server must enforce this itself.

---

### Server-side gap B — SLA summary endpoint has no feature gate

`GET /dashboard/sla-summary` uses only `requireOrg`. Every other SLA endpoint uses `requireSlaTrackingFeature`. The summary endpoint should be consistent: if the feature is off for an org, the endpoint should return 403 rather than running expensive queries against no SLA data.

---

## Done looks like

- Opening the Custom Fields tab in org settings no longer throws "Maximum update depth exceeded".
- Non-admin users visiting org settings no longer produce 403 requests to `/api/orgs/invitations`.
- For an org with `sla_tracking` disabled: no 403 requests appear in the Network tab from any page (dashboard, task list, task detail, project detail).
- For an org with `custom_statuses` disabled: no 403 requests appear from task list, task detail, modals, or project detail.
- For an org with `webhooks` disabled: no 403 requests from the webhooks pages.
- Any endpoint that returns a 4xx response is not retried; the error surfaces immediately.
- Stable data (roles, stages, templates, custom fields) is not refetched every 8 s on idle pages.
- Non-admin org members can no longer create, rename, or delete projects via direct API calls — the server enforces `manage_projects`.
- `GET /dashboard/sla-summary` returns 403 for orgs without the `sla_tracking` feature, consistent with all other SLA endpoints.
- Admin and owner users are unaffected; all their existing functionality continues to work.

## Out of scope

- Changing the global `refetchInterval` value — done in Task #425 once SSE is in place.
- Fixing the SLA overshoot calculation (Task #219).
- Stage reorder cross-org isolation (Task #230).
- `GET /orgs/members`, `GET /roles`, `GET /task-templates`, `GET /custom-fields` — these are intentionally open to all org members and need no guard.

## Steps

### Client — fix the render loop

1. **Stabilise the `allFields` default in `custom-fields-manager.tsx`** — Declare a module-level constant `const EMPTY_FIELDS: CustomFieldDefinition[] = []` and use `data: allFields = EMPTY_FIELDS` in the hook destructuring. This gives React a stable reference when data is not yet loaded so the `useEffect([allFields])` no longer fires every render.

### Client — add `enabled` guards for permission-gated queries

2. **Guard `useListOrgInvitations`** — In `org-settings.tsx`, add `{ query: { enabled: hasPermission("manage_members") } }` to the call at the root `OrgSettings` component level. Preserve the `refetch: refetchInvitations` binding.

3. **Guard `useGetSLAPolicies` everywhere it is called unconditionally** — In `dashboard.tsx`, `tasks.tsx`, `project-detail.tsx`, and `task-detail.tsx`, add `{ query: { enabled: isFeatureEnabled('sla_tracking') } }` to each `useGetSLAPolicies()` call. Use the `isFeatureEnabled` helper from `useOrgContext()`.

4. **Guard `useGetDashboardSlaSummary`** — In `dashboard.tsx`, add `{ query: { enabled: isFeatureEnabled('sla_tracking') } }` to the `useGetDashboardSlaSummary` call.

5. **Guard `useListWorkflowStages` everywhere it is called unconditionally** — In `task-detail.tsx`, `tasks.tsx`, `project-detail.tsx`, `new-task-modal.tsx`, and `edit-task-modal.tsx`, add `{ query: { enabled: isFeatureEnabled('custom_statuses') } }`. Each of these files renders for all org members; if the feature is off they should receive an empty array gracefully (the existing `= []` default handles this).

6. **Guard webhook hooks** — In `webhooks.tsx`, `webhook-inbound-edit.tsx`, and `webhook-outbound-edit.tsx`, add `{ query: { enabled: isFeatureEnabled('webhooks') } }` to the `useListInboundWebhooks` and `useListOutboundWebhooks` calls.

### Client — defense-in-depth guards for component-gated queries

7. **Guard `useGetOrgAuditLog`** — In `audit-log.tsx`, add `{ query: { enabled: hasPermission('view_audit_log') } }` to prevent the query from ever firing if the page somehow renders without the permission.

8. **Guard `useSlaAuditHistory`** — In `project-detail.tsx`, wrap the raw `fetch(…/sla-policy-audit)` in a `queryFn` that is only enabled when `hasPermission('view_audit_log') || hasPermission('manage_sla_policies')`, or add an early-return guard before the `useQuery` call that returns `undefined` data immediately when neither permission is held.

9. **Guard `useListApiKeys`** — In `ApiKeysCard` inside `org-settings.tsx`, add `{ query: { enabled: isOwner } }` to the `useListApiKeys()` call.

### Client — global query client settings

10. **Stop retrying on 4xx errors globally** — In `query-client.ts`, add a `retry` function to `defaultOptions.queries` that returns `false` when `error?.status` is between 400 and 499 (inclusive), and `failureCount < 3` otherwise. The `ApiError` class from `custom-fetch.ts` exposes `.status` directly.

11. **Increase staleTime** — In `query-client.ts`, raise the default `staleTime` from `0` to `30_000` (30 seconds). Queries that need fresh data on every mount can pass their own `staleTime: 0` override.

### Server — close permission gaps

12. **Add `requirePermission('manage_projects')` to project mutations** — In `routes/projects.ts`, add `requirePermission('manage_projects')` to the middleware chain of `POST /projects`, `PATCH /projects/:id`, and `DELETE /projects/:id`. This matches the client-side restriction (only admins see create/edit/delete controls) and prevents any non-admin from mutating projects via a direct API call.

13. **Add feature gate to `GET /dashboard/sla-summary`** — In `routes/dashboard.ts`, define `const requireSlaTrackingFeature = requireOrgFeature('sla_tracking')` (the same pattern used in `routes/orgs.ts`) and add it to the `GET /dashboard/sla-summary` middleware chain. Import `requireOrgFeature` from `../lib/org-features`.

## Relevant files

- `artifacts/it-task-manager/src/components/ui/custom-fields-manager.tsx:537-553`
- `artifacts/it-task-manager/src/pages/org-settings.tsx` (root component, ApiKeysCard)
- `artifacts/it-task-manager/src/pages/dashboard.tsx`
- `artifacts/it-task-manager/src/pages/tasks.tsx`
- `artifacts/it-task-manager/src/pages/task-detail.tsx`
- `artifacts/it-task-manager/src/pages/project-detail.tsx`
- `artifacts/it-task-manager/src/pages/audit-log.tsx`
- `artifacts/it-task-manager/src/pages/webhooks.tsx`
- `artifacts/it-task-manager/src/pages/webhook-inbound-edit.tsx`
- `artifacts/it-task-manager/src/pages/webhook-outbound-edit.tsx`
- `artifacts/it-task-manager/src/components/ui/new-task-modal.tsx`
- `artifacts/it-task-manager/src/components/ui/edit-task-modal.tsx`
- `artifacts/it-task-manager/src/lib/query-client.ts`
- `lib/api-client-react/src/custom-fetch.ts` (ApiError.status)
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/dashboard.ts`
- `artifacts/api-server/src/lib/org-features.ts` (requireOrgFeature)
