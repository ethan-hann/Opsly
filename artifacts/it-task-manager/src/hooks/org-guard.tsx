import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useGetMyOrg, onOrgSuspended } from "@workspace/api-client-react";
import { useAuth } from "@workspace/auth-web";
import { useSseEvent } from "@/hooks/use-sse";
import type { PendingInvitation, RolePermissions } from "@workspace/api-client-react";
import { OrgContext, type OrgContextValue, type OrgFeatureKey, type OrgFeatureState } from "@/hooks/use-org-context";
import { OwnershipCelebration } from "@/components/ui/ownership-celebration";
import { OrgSuspendedModal } from "@/components/ui/org-suspended-modal";

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
  const { logout } = useAuth();
  const {
    data,
    isLoading,
    refetch,
  } = useGetMyOrg();

  const refetchOrg = useCallback(() => {
    refetch();
  }, [refetch]);

  // ── Mid-session suspension detection ───────────────────────────────────────
  // Fires when any API response returns 403 { error: 'org_suspended' }, even
  // before the org query has had a chance to refetch.
  const [isSuspendedMidSession, setIsSuspendedMidSession] = useState(false);
  useEffect(() => {
    return onOrgSuspended(() => setIsSuspendedMidSession(true));
  }, []);

  // Long-interval poll as a fallback for missed SSE events (e.g. reconnects).
  // The SSE connection provides near-instant delivery for the common path.
  useEffect(() => {
    const id = setInterval(() => { refetch(); }, 60_000);
    return () => clearInterval(id);
  }, [refetch]);

  // ── SSE: react to role-change events pushed from the server ────────────────
  // Uses the shared SSE singleton so we don't open a competing EventSource.
  const handleRoleChanged = useCallback(() => {
    refetch();
  }, [refetch]);
  useSseEvent("role-changed", handleRoleChanged);

  // ── Ownership transition detection ─────────────────────────────────────────
  // Track whether the current user was already an owner on the *previous*
  // render so we can detect the false→true transition during a live session.
  // null = not yet observed (initial mount), so we don't fire on page load.
  const prevIsOwner = useRef<boolean | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  const permissions = data?.org ? (data.permissions ?? null) : null;
  const isOwner = data?.roleName === "Owner" && permissions?.manage_org_settings === true;

  useEffect(() => {
    if (prevIsOwner.current === false && isOwner) {
      setShowCelebration(true);
    }
    if (data?.org) {
      prevIsOwner.current = isOwner;
    }
  }, [isOwner, data?.org]);

  // ── Render ─────────────────────────────────────────────────────────────────

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

  // Org is suspended at login time (isDisabled flag on the org object).
  // Show the non-closable modal over a blank background — no children are
  // rendered yet since the OrgContext hasn't been provided.
  const isLoginTimeSuspended = (data.org as { isDisabled?: boolean }).isDisabled === true;
  if (isLoginTimeSuspended) {
    return <OrgSuspendedModal open onSignOut={logout} />;
  }

  function hasPermission(key: keyof RolePermissions): boolean {
    return permissions?.[key] === true;
  }

  // Feature-state helpers
  const features = (data.features ?? {}) as Partial<Record<OrgFeatureKey, OrgFeatureState>>;

  function isFeatureEnabled(feature: OrgFeatureKey): boolean {
    const state = features[feature];
    // Absent key = default 'enabled'
    return state === undefined || state === "enabled";
  }

  function isFeatureUnsubscribed(feature: OrgFeatureKey): boolean {
    return features[feature] === "unsubscribed";
  }

  // Has org - render main app with context
  const value: OrgContextValue = {
    org: data.org,
    roleId: data.roleId ?? null,
    roleName: data.roleName ?? null,
    permissions,
    pendingInvitation: null,
    isAdmin: hasPermission("manage_projects"),
    // roleName === "Owner" is the authoritative check; manage_org_settings is
    // Owner-only so it doubles as a safety guard against custom roles named "Owner".
    isOwner,
    hasPermission,
    refetchOrg,
    features,
    isFeatureEnabled,
    isFeatureUnsubscribed,
  };

  return (
    <OrgContext.Provider value={value}>
      {children}
      {/* Mid-session suspension: modal overlays the current page */}
      <OrgSuspendedModal open={isSuspendedMidSession} onSignOut={logout} />
      <OwnershipCelebration
        open={showCelebration}
        onClose={() => setShowCelebration(false)}
        orgName={data.org.name}
      />
    </OrgContext.Provider>
  );
}
