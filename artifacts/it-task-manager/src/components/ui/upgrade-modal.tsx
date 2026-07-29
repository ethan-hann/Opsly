/**
 * UpgradeModal + UpgradeBanner — placeholder billing-gate components.
 *
 * These are intentional stubs. When real subscription/billing support lands,
 * replace the UpgradeModal body with pricing plan content and wire the
 * "Upgrade" button to the payment flow. The `feature` prop is already threaded
 * through so the modal can show feature-specific copy later.
 *
 * The UpgradeBanner is the inline UI rendered by FeatureGate when a feature is
 * in the 'unsubscribed' state.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Lock } from "lucide-react";
import type { OrgFeatureKey } from "@/hooks/use-org-context";

// ─── Display names ────────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<OrgFeatureKey, string> = {
  webhooks: "Webhooks",
  api_keys: "API Keys",
  custom_fields: "Custom Fields",
  custom_statuses: "Workflow Stages",
  sla_tracking: "SLA Tracking",
  branding: "Branding",
  task_trees: "Task Trees",
};

const FEATURE_DESCRIPTIONS: Record<OrgFeatureKey, string> = {
  webhooks:
    "Send and receive real-time events with external systems via inbound and outbound webhooks.",
  api_keys:
    "Issue machine credentials to let scripts and integrations access your org's data programmatically.",
  custom_fields:
    "Add typed custom fields (text, number, date, select) to every task in your organization.",
  custom_statuses:
    "Define custom workflow stages with colors to replace the built-in open/closed states.",
  sla_tracking:
    "Set response and resolution SLA policies per priority and get warned when tasks are at risk of breaching.",
  branding:
    "Apply a custom primary color and logo to white-label the app for your organization.",
  task_trees:
    "Model work hierarchies by linking tasks with parent dependencies and visualize the full project tree.",
};

// ─── UpgradeModal ─────────────────────────────────────────────────────────────

interface UpgradeModalProps {
  feature: OrgFeatureKey;
  open: boolean;
  onClose: () => void;
}

export function UpgradeModal({ feature, open, onClose }: UpgradeModalProps) {
  const label = FEATURE_LABELS[feature];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <DialogTitle>Unlock {label}</DialogTitle>
          <DialogDescription className="mt-1">
            {FEATURE_DESCRIPTIONS[feature]}
          </DialogDescription>
        </DialogHeader>

        {/* Stub body — replace with real pricing UI when billing lands */}
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground text-center">
          Subscription plans coming soon. Contact your administrator to enable this feature.
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {/* Stub CTA — wire to real payment flow later */}
          <Button disabled className="gap-1.5 opacity-60 cursor-not-allowed">
            <Sparkles className="w-4 h-4" />
            Upgrade Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── UpgradeBanner ────────────────────────────────────────────────────────────

interface UpgradeBannerProps {
  feature: OrgFeatureKey;
  /** When true, renders a compact inline chip rather than a full card. */
  compact?: boolean;
}

export function UpgradeBanner({ feature, compact = false }: UpgradeBannerProps) {
  const [open, setOpen] = useState(false);
  const label = FEATURE_LABELS[feature];
  const description = FEATURE_DESCRIPTIONS[feature];

  if (compact) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
        >
          <Lock className="w-3 h-3" />
          Upgrade
        </button>
        <UpgradeModal feature={feature} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-6 flex flex-col items-center gap-3 text-center">
        <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
          <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <p className="font-semibold text-stone-800 dark:text-stone-100">{label}</p>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 max-w-sm">
            {description}
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          size="sm"
          className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Upgrade to unlock
        </Button>
      </div>
      <UpgradeModal feature={feature} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
