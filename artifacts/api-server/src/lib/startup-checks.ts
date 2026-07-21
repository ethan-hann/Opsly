import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Warn operators when the instance has no admin access configured.
 * Runs once after the server starts; errors are non-fatal (just logged).
 */
export async function warnIfNoAdminConfigured(): Promise<void> {
  try {
    if (process.env.INSTANCE_ADMIN_TOKEN) {
      // Static token is set — instance admin access is available.
      return;
    }

    const [row] = await db
      .select({ isInstanceAdmin: usersTable.isInstanceAdmin })
      .from(usersTable)
      .where(eq(usersTable.isInstanceAdmin, true))
      .limit(1);

    if (!row) {
      logger.warn(
        [
          "No instance administrator is configured.",
          "Set INSTANCE_ADMIN_TOKEN in the environment, or promote a user with:",
          "  DATABASE_URL=<url> pnpm --filter @workspace/db make-admin <email>",
          "Until one of these is set, instance-admin endpoints are inaccessible.",
        ].join(" "),
      );
    }
  } catch (err) {
    // Don't crash startup over a non-critical check.
    logger.warn({ err }, "Could not verify instance-admin configuration");
  }
}
