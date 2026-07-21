/**
 * One-click unsubscribe route for digest emails.
 *
 * GET /api/unsubscribe?token=<signed-jwt>
 *
 * Validates the signed token (user ID + expiry), sets
 * email_digest_preferences.frequency = "none", and returns a JSON
 * confirmation. The frontend /unsubscribe page calls this endpoint and
 * renders the result.
 *
 * No auth middleware — the signed token IS the proof of identity.
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, emailDigestPreferencesTable } from "@workspace/db";
import { verifyUnsubscribeToken } from "../lib/unsubscribe-token";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/unsubscribe", async (req, res): Promise<void> => {
  const token = typeof req.query["token"] === "string" ? req.query["token"] : "";

  if (!token) {
    res.status(400).json({ ok: false, error: "Missing token" });
    return;
  }

  let result: ReturnType<typeof verifyUnsubscribeToken>;
  try {
    result = verifyUnsubscribeToken(token);
  } catch (err) {
    // SESSION_SECRET not configured — fail closed rather than accepting forged tokens
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Unsubscribe token verification failed — misconfigured server");
    res.status(503).json({ ok: false, error: message });
    return;
  }

  if (!result.ok) {
    res.status(400).json({ ok: false, error: `Invalid or expired link: ${result.reason}` });
    return;
  }

  const { userId } = result;

  try {
    const now = new Date();

    // Upsert: set frequency to "none" whether or not a row already exists.
    await db
      .insert(emailDigestPreferencesTable)
      .values({ userId, frequency: "none", updatedAt: now })
      .onConflictDoUpdate({
        target: emailDigestPreferencesTable.userId,
        set: { frequency: "none", updatedAt: now },
      });

    logger.info({ userId }, "User unsubscribed from digest emails via one-click link");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "Failed to process unsubscribe request");
    res.status(500).json({ ok: false, error: "Failed to update preference" });
  }
});

export default router;
