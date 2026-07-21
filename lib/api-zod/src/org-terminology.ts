import { z } from 'zod';

// ─── Term key validation ──────────────────────────────────────────────────────

export const TERMINOLOGY_KEYS = [
  'projects',
  'tasks',
  'members',
  'workflows',
  'stages',
] as const;

export type TerminologyKey = (typeof TERMINOLOGY_KEYS)[number];

/** Validated label: non-empty, max 50 characters. */
const terminologyLabel = z.string().min(1, 'Label must not be empty').max(50, 'Label must be 50 characters or fewer');

// ─── Zod schemas ─────────────────────────────────────────────────────────────

/**
 * A map of all five terminology keys to their current labels.
 * Used in GET responses where all keys are always present (resolved with defaults).
 */
export const OrgTerminologyMap = z.object({
  projects: z.string(),
  tasks: z.string(),
  members: z.string(),
  workflows: z.string(),
  stages: z.string(),
});

export type OrgTerminologyMapType = z.infer<typeof OrgTerminologyMap>;

/** Response from GET /api/orgs/terminology — always returns all five keys. */
export const GetOrgTerminologyResponse = OrgTerminologyMap;
export type GetOrgTerminologyResponseType = z.infer<typeof GetOrgTerminologyResponse>;

/**
 * Body for PATCH /api/orgs/terminology — partial map; only supplied keys are upserted.
 * Each label must be a non-empty string of at most 50 characters.
 */
export const PatchOrgTerminologyBody = z.object({
  projects: terminologyLabel.optional(),
  tasks: terminologyLabel.optional(),
  members: terminologyLabel.optional(),
  workflows: terminologyLabel.optional(),
  stages: terminologyLabel.optional(),
}).refine(
  (body) => Object.keys(body).length > 0,
  { message: 'At least one terminology key must be provided' },
);

export type PatchOrgTerminologyBodyType = z.infer<typeof PatchOrgTerminologyBody>;

/** Response from PATCH /api/orgs/terminology — returns the full resolved map after update. */
export const PatchOrgTerminologyResponse = OrgTerminologyMap;
export type PatchOrgTerminologyResponseType = z.infer<typeof PatchOrgTerminologyResponse>;
