import * as zod from "zod";

// ─── System default palette ───────────────────────────────────────────────────

/**
 * The default reaction palette used when an org has not set a custom one.
 * 12 common Unicode emoji.
 */
export const DEFAULT_REACTION_PALETTE: string[] = [
  "👍", "👎", "❤️", "😂", "😮", "😢", "🎉", "🙌", "🔥", "✅", "🤔", "👀",
];

// ─── Reaction summary (returned with comment list) ───────────────────────────

export const ReactionSummary = zod.object({
  emoji: zod.string(),
  count: zod.number().int(),
  userIds: zod.array(zod.string()),
});

export type ReactionSummaryType = zod.infer<typeof ReactionSummary>;

// ─── Palette endpoints ────────────────────────────────────────────────────────

export const GetReactionPaletteResponse = zod.object({
  palette: zod.array(zod.string()),
});

export const PatchReactionPaletteBody = zod.object({
  palette: zod
    .array(zod.string())
    .min(1, "Palette must contain at least one emoji"),
});

export type GetReactionPaletteResponseType = zod.infer<typeof GetReactionPaletteResponse>;
export type PatchReactionPaletteBodyType = zod.infer<typeof PatchReactionPaletteBody>;

// ─── Reaction toggle endpoints ────────────────────────────────────────────────

export const AddReactionParams = zod.object({
  id: zod.coerce.number().int(),
});

export const AddReactionBody = zod.object({
  emoji: zod.string().min(1),
});

export const DeleteReactionParams = zod.object({
  id: zod.coerce.number().int(),
  emoji: zod.string().min(1),
});

export const ReactionToggleResponse = zod.object({
  ok: zod.literal(true),
});
