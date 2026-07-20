/**
 * API Key management routes.
 *
 * GET    /api-keys         — list all API keys for the org (metadata only, never hash)
 * POST   /api-keys         — create a new API key (returns full key value once)
 * DELETE /api-keys/:id     — revoke an API key
 *
 * All routes require manage_api_keys permission (Owner-only by default).
 * API key auth is explicitly rejected on these routes (session only).
 */

import crypto from 'crypto';
import { Router, type IRouter } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, apiKeysTable, usersTable, API_KEY_SCOPES } from '@workspace/db';
import type { ApiKeyScope } from '@workspace/db';
import {
  requireOrg,
  requirePermission,
} from '../middlewares/requireOrgMiddleware';
import { requireOrgFeature } from '../lib/org-features';

const router: IRouter = Router();

// All API key management routes require the api_keys feature to be enabled.
const requireApiKeysFeature = requireOrgFeature('api_keys');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a cryptographically secure API key with the opsly_ prefix. */
function generateApiKey(): string {
  return `opsly_${crypto.randomBytes(32).toString('hex')}`;
}

/** SHA-256 hex digest of a key value. */
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function formatKey(row: typeof apiKeysTable.$inferSelect, creator?: { firstName: string | null; lastName: string | null; email: string | null }) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes as ApiKeyScope[],
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    isExpired: row.expiresAt ? row.expiresAt < new Date() : false,
    createdBy: creator
      ? {
          firstName: creator.firstName,
          lastName: creator.lastName,
          email: creator.email,
        }
      : null,
  };
}

// ─── GET /api-keys ────────────────────────────────────────────────────────────

router.get(
  '/api-keys',
  requireOrg,
  requireApiKeysFeature,
  requirePermission('manage_api_keys'),
  async (req, res): Promise<void> => {
    // Reject API key auth on management routes
    if (req.apiKeyId) {
      res.status(403).json({ error: 'API key management requires session authentication' });
      return;
    }

    const orgId = req.orgId!;

    const rows = await db
      .select({
        key: apiKeysTable,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(apiKeysTable)
      .leftJoin(usersTable, eq(apiKeysTable.createdBy, usersTable.id))
      .where(eq(apiKeysTable.orgId, orgId))
      .orderBy(apiKeysTable.createdAt);

    res.json(
      rows.map((r) =>
        formatKey(r.key, { firstName: r.firstName ?? null, lastName: r.lastName ?? null, email: r.email ?? null }),
      ),
    );
  },
);

// ─── POST /api-keys ───────────────────────────────────────────────────────────

const API_KEY_SCOPES_TUPLE = API_KEY_SCOPES as unknown as [ApiKeyScope, ...ApiKeyScope[]];

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.enum(API_KEY_SCOPES_TUPLE)).min(1),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

router.post(
  '/api-keys',
  requireOrg,
  requireApiKeysFeature,
  requirePermission('manage_api_keys'),
  async (req, res): Promise<void> => {
    if (req.apiKeyId) {
      res.status(403).json({ error: 'API key management requires session authentication' });
      return;
    }

    const parsed = CreateApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { name, scopes, expiresAt } = parsed.data;
    const orgId = req.orgId!;
    const userId = req.user!.id;

    const rawKey = generateApiKey();
    const keyPrefix = rawKey.slice(0, 8);
    const keyHash = hashKey(rawKey);

    const [row] = await db
      .insert(apiKeysTable)
      .values({
        orgId,
        name,
        keyPrefix,
        keyHash,
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: userId,
      })
      .returning();

    res.status(201).json({
      ...formatKey(row),
      // Full key is returned exactly once at creation time.
      key: rawKey,
    });
  },
);

// ─── DELETE /api-keys/:id (revoke) ───────────────────────────────────────────

router.delete(
  '/api-keys/:id',
  requireOrg,
  requireApiKeysFeature,
  requirePermission('manage_api_keys'),
  async (req, res): Promise<void> => {
    if (req.apiKeyId) {
      res.status(403).json({ error: 'API key management requires session authentication' });
      return;
    }

    const id = String(req.params['id']);
    const orgId = req.orgId!;

    const [existing] = await db
      .select({ id: apiKeysTable.id, revokedAt: apiKeysTable.revokedAt })
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.orgId, orgId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    if (existing.revokedAt) {
      res.status(409).json({ error: 'API key already revoked' });
      return;
    }

    const [updated] = await db
      .update(apiKeysTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.orgId, orgId), isNull(apiKeysTable.revokedAt)))
      .returning();

    res.json(formatKey(updated));
  },
);

export default router;
