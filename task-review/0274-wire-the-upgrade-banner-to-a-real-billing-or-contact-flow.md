# #274 — Wire the Upgrade banner to a real billing or contact flow

**State:** PROPOSED
**Depends on:** #181

---

# Wire the Upgrade banner to a real billing or contact flow

## What & Why
The `UpgradeModal` and `UpgradeBanner` components introduced in Task #181 are deliberate stubs — they show placeholder copy and a disabled "Upgrade Plan" button. When the org's plan and billing are implemented, the modal needs to either link to a pricing/checkout page or open a "contact sales" flow so the user can actually act on the prompt.

## Done looks like
- `UpgradeModal` shows real pricing tiers or a contact form instead of the "coming soon" placeholder
- The "Upgrade Plan" button is enabled and navigates to the appropriate flow
- The feature label and description copy in `artifacts/it-task-manager/src/components/ui/upgrade-modal.tsx` are reviewed and finalised for each feature

## Relevant files
- `artifacts/it-task-manager/src/components/ui/upgrade-modal.tsx`
- `artifacts/api-server/src/routes/admin.ts` (admin can already set `featureState: 'unsubscribed'` via PATCH /admin/orgs/:id/features)
