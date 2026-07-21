import app from "./app";
import { logger } from "./lib/logger";
import { initStorageProvider } from "./lib/storage/provider";
import { startSlaPoller } from "./lib/sla-poller";
import { startNotificationPruner } from "./lib/notification-pruner";
import { startDigestMailer } from "./lib/digest-mailer";
import { db, usersTable } from "@workspace/db";
import { loadSmtpOverride } from "./lib/email";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Validate storage config eagerly — logs FATAL and exits(1) if misconfigured.
initStorageProvider();

/**
 * Warn operators when the instance has no admin access configured.
 * Runs once after the server starts; errors are non-fatal (just logged).
 */
async function warnIfNoAdminConfigured(): Promise<void> {
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

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void warnIfNoAdminConfigured();
  // Load any DB-persisted SMTP override so the first email after startup uses
  // the correct config without needing a manual re-save.
  void loadSmtpOverride();
  const slaPoller = startSlaPoller();
  const notificationPruner = startNotificationPruner();
  const digestMailer = startDigestMailer();

  // Graceful shutdown: clear background intervals before the process exits so
  // in-flight scans are not cut off mid-write and the event loop drains cleanly.
  const shutdown = (signal: string) => {
    logger.info({ signal }, "Graceful shutdown initiated");
    if (slaPoller) clearInterval(slaPoller);
    if (notificationPruner) clearInterval(notificationPruner);
    if (digestMailer) clearInterval(digestMailer);
    server.close(() => {
      logger.info("HTTP server closed — exiting");
      process.exit(0);
    });
    // Force-exit after 10 s if connections don't drain
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
});
