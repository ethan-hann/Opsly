import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useGetMyOrg } from "@workspace/api-client-react";
import type { OrgMeResponse, Organization, PendingInvitation } from "@workspace/api-client-react";

// ─── Context ─────────────────────────────────────────────────────────────────

interface OrgContextValue {
  org: Organization | null;
  role: "admin" | "member" | null;
  pendingInvitation: PendingInvitation | null;
  isAdmin: boolean;
  refetchOrg: () => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrgContext(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgContext must be used within OrgGuard");
  return ctx;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

interface OrgGuardProps {
  children: ReactNode;
  /** Render prop — receives a stable `onCreated` callback that triggers an
   *  immediate refetch of the org query so the guard transitions without a
   *  full page reload. */
  onboarding: (onCreated: () => void) => ReactNode;
  invitation: (inv: PendingInvitation) => ReactNode;
}

export function OrgGuard({ children, onboarding, invitation }: OrgGuardProps) {
  const {
    data,
    isLoading,
    refetch,
  } = useGetMyOrg();

  const refetchOrg = useCallback(() => {
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading organization…</p>
        </div>
      </div>
    );
  }

  // Pending invitation — show invitation screen
  if (data?.pendingInvitation) {
    return <>{invitation(data.pendingInvitation)}</>;
  }

  // No org — show onboarding; pass refetch as the onCreated callback so the
  // guard transitions immediately without relying on query-key matching.
  if (!data?.org) {
    return <>{onboarding(refetch)}</>;
  }

  // Has org — render main app with context
  const value: OrgContextValue = {
    org: data.org,
    role: data.role ?? null,
    pendingInvitation: null,
    isAdmin: data.role === "admin",
    refetchOrg,
  };

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
