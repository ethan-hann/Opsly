import { and, eq } from 'drizzle-orm';
import { db, orgFeaturesTable } from '@workspace/db';
import type { OrgFeature } from '@workspace/db';
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
