/**
 * FeatureGate — renders children based on the org's feature state.
 *
 * | Feature state  | Renders                                |
 * |----------------|----------------------------------------|
 * | 'enabled'      | children (normal render)               |
 * | 'disabled'     | nothing (hard-off by instance admin)   |
 * | 'unsubscribed' | <UpgradeBanner> in place of children   |
 *
 * All gating calls throughout the app funnel through this single component so
 * the behaviour is consistent and easy to change from one place.
 *
 * Usage:
 *   <FeatureGate feature="webhooks">
 *     <WebhooksPage />
 *   </FeatureGate>
 *
 *   <FeatureGate feature="sla_tracking" compact>
 *     <SlaBadge ... />
 *   </FeatureGate>
 */

import type { ReactNode } from "react";
import { useOrgContext } from "@/hooks/use-org-context";
import type { OrgFeatureKey } from "@/hooks/use-org-context";
import { UpgradeBanner } from "@/components/ui/upgrade-modal";

interface FeatureGateProps {
  feature: OrgFeatureKey;
  children: ReactNode;
  /**
   * When true, the UpgradeBanner renders in compact mode (a small chip
   * instead of a full card). Useful inside dense layouts like task rows.
   */
  compact?: boolean;
}

export function FeatureGate({ feature, children, compact = false }: FeatureGateProps) {
  const { isFeatureEnabled, isFeatureUnsubscribed } = useOrgContext();

  // Hard-off: instance admin disabled this feature — render nothing
  if (!isFeatureEnabled(feature) && !isFeatureUnsubscribed(feature)) {
    return null;
  }

  // Unsubscribed: not in the org's plan — show upgrade prompt
  if (isFeatureUnsubscribed(feature)) {
    return <UpgradeBanner feature={feature} compact={compact} />;
  }

  // Enabled: render normally
  return <>{children}</>;
}
