import { and, eq } from 'drizzle-orm';
import { db, orgFeaturesTable, ORG_FEATURES } from '@workspace/db';
import type { OrgFeature, OrgFeatureState } from '@workspace/db';
import type { NextFunction, Request, Response } from 'express';

/**
 * Check whether a feature is enabled for an org.
 * Defaults to enabled if no row exists (opt-out model — existing orgs are unaffected).
 */
export async function isOrgFeatureEnabled(orgId: string, feature: OrgFeature): Promise<boolean> {
  const [row] = await db
    .select({ enabled: orgFeaturesTable.enabled })
    .from(orgFeaturesTable)
    .where(and(eq(orgFeaturesTable.orgId, orgId), eq(orgFeaturesTable.feature, feature)))
    .limit(1);

  // No row = not configured = default enabled
  return row?.enabled ?? true;
}

/**
 * Return the full feature-state map for an org.
 * Each key is an OrgFeature; the value is 'enabled', 'disabled', or 'unsubscribed'.
 * Features with no row default to 'enabled'.
 */
export async function getOrgFeatureStates(
  orgId: string,
): Promise<Record<OrgFeature, OrgFeatureState>> {
  const rows = await db
    .select({
      feature: orgFeaturesTable.feature,
      featureState: orgFeaturesTable.featureState,
    })
    .from(orgFeaturesTable)
    .where(eq(orgFeaturesTable.orgId, orgId));

  const result = {} as Record<OrgFeature, OrgFeatureState>;
  for (const feat of ORG_FEATURES) {
    result[feat] = 'enabled'; // default
  }
  for (const row of rows) {
    // Ignore rows for features that have since been retired from ORG_FEATURES —
    // otherwise a stale row would re-introduce a gate that no longer exists.
    if (!ORG_FEATURES.includes(row.feature)) continue;
    result[row.feature] = (row.featureState ?? 'enabled') as OrgFeatureState;
  }
  return result;
}

/**
 * Route middleware: requires a specific org feature to be enabled.
 * Must be used after requireOrg (which sets req.orgId).
 */
export function requireOrgFeature(feature: OrgFeature) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.orgId;
    if (!orgId) {
      res.status(403).json({ error: 'No organization context' });
      return;
    }

    const enabled = await isOrgFeatureEnabled(orgId, feature);
    if (!enabled) {
      res.status(403).json({
        error: 'feature_disabled',
        feature,
        message: `The "${feature}" feature is not enabled for your organization. Contact your instance administrator.`,
      });
      return;
    }

    next();
  };
}
