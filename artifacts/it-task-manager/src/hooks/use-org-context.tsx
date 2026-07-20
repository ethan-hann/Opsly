import { createContext, useContext } from "react";
import type { Organization, PendingInvitation, RolePermissions } from "@workspace/api-client-react";

// ─── Context value type ───────────────────────────────────────────────────────

export interface OrgContextValue {
  org: Organization | null;
  role: "admin" | "member" | null;
  roleId: string | null;
  roleName: string | null;
  permissions: RolePermissions | null;
  pendingInvitation: PendingInvitation | null;
  isAdmin: boolean;
  isOwner: boolean;
  hasPermission: (key: keyof RolePermissions) => boolean;
  refetchOrg: () => void;
}

// ─── Context object (exported so OrgGuard can provide it) ────────────────────

export const OrgContext = createContext<OrgContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrgContext(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgContext must be used within OrgGuard");
  return ctx;
}
