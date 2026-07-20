import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useGetMyOrg } from "@workspace/api-client-react";
import type { OrgMeResponse, Organization, PendingInvitation, RolePermissions } from "@workspace/api-client-react";
import { OwnershipCelebration } from "@/components/ui/ownership-celebration";

// ─── Context ─────────────────────────────────────────────────────────────────

interface OrgContextValue {
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

const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrgContext(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgContext must be used within OrgGuard");
  return ctx;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

interface OrgGuardProps {
  children: ReactNode;
  /** Render prop - receives a stable `onCreated` callback that triggers an
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
  } = useGetMyOrg({
    query: {
      // Poll every 15 s so a newly promoted owner sees the celebration
      // without needing a manual page refresh.
      refetchInterval: 15_000,
    },
  });

  const refetchOrg = useCallback(() => {
    refetch();
  }, [refetch]);

  // Track whether the current user was already an owner on the *previous*
  // render so we can detect the false→true transition during a live session.
  // null = not yet observed (initial mount), so we don't fire on page load.
  const prevIsOwner = useRef<boolean | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  const permissions = data?.org ? (data.permissions ?? null) : null;
  const isOwner = data?.roleName === "Owner" && permissions?.manage_org_settings === true;

  useEffect(() => {
    if (prevIsOwner.current === false && isOwner) {
      // Transitioned from non-owner to owner in this session — celebrate!
      setShowCelebration(true);
    }
    if (data?.org) {
      // Only record a known value once we have real org data.
      prevIsOwner.current = isOwner;
    }
  }, [isOwner, data?.org]);

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

  // Pending invitation - show invitation screen
  if (data?.pendingInvitation) {
    return <>{invitation(data.pendingInvitation)}</>;
  }

  // No org - show onboarding; pass refetch as the onCreated callback so the
  // guard transitions immediately without relying on query-key matching.
  if (!data?.org) {
    return <>{onboarding(refetch)}</>;
  }

  function hasPermission(key: keyof RolePermissions): boolean {
    return permissions?.[key] === true;
  }

  // Has org - render main app with context
  const value: OrgContextValue = {
    org: data.org,
    role: data.role ?? null,
    roleId: data.roleId ?? null,
    roleName: data.roleName ?? null,
    permissions,
    pendingInvitation: null,
    isAdmin: data.role === "admin",
    // roleName === "Owner" is the authoritative check; manage_org_settings is
    // Owner-only so it doubles as a safety guard against custom roles named "Owner".
    isOwner,
    hasPermission,
    refetchOrg,
  };

  return (
    <OrgContext.Provider value={value}>
      {children}
      <OwnershipCelebration
        open={showCelebration}
        onClose={() => setShowCelebration(false)}
        orgName={data.org.name}
      />
    </OrgContext.Provider>
  );
}
