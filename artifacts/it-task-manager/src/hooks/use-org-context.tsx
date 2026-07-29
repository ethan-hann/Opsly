import { createContext, useContext } from "react";
import type { Organization, PendingInvitation, RolePermissions } from "@workspace/api-client-react";

// ─── Feature types ────────────────────────────────────────────────────────────

// Data export is intentionally not gateable — see ORG_FEATURES in
// lib/db/src/schema/instance-admin.ts.
export type OrgFeatureKey =
  | "webhooks"
  | "api_keys"
  | "custom_fields"
  | "custom_statuses"
  | "sla_tracking"
  | "branding"
  | "task_trees";

export type OrgFeatureState = "enabled" | "disabled" | "unsubscribed";

// ─── Context value type ───────────────────────────────────────────────────────

export interface OrgContextValue {
  org: Organization | null;
  roleId: string | null;
  roleName: string | null;
  permissions: RolePermissions | null;
  pendingInvitation: PendingInvitation | null;
  /** True when the user has the `manage_projects` permission (Admin or Owner). */
  isAdmin: boolean;
  isOwner: boolean;
  hasPermission: (key: keyof RolePermissions) => boolean;
  refetchOrg: () => void;

  /** Full feature-state map. Absent keys default to 'enabled'. */
  features: Partial<Record<OrgFeatureKey, OrgFeatureState>>;
  /**
   * Returns true only when the feature state is 'enabled'.
   * Returns true for unknown/absent keys (opt-out model).
   */
  isFeatureEnabled: (feature: OrgFeatureKey) => boolean;
  /**
   * Returns true when the feature state is 'unsubscribed'.
   * Used to show Upgrade prompts in place of real content.
   */
  isFeatureUnsubscribed: (feature: OrgFeatureKey) => boolean;
}

// ─── Context object (exported so OrgGuard can provide it) ────────────────────

export const OrgContext = createContext<OrgContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrgContext(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgContext must be used within OrgGuard");
  return ctx;
}
