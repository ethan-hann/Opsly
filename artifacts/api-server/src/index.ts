import app from "./app";
import { logger } from "./lib/logger";
import { startSlaPoller } from "./lib/sla-poller";
import { startNotificationPruner } from "./lib/notification-pruner";

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

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  const slaPoller = startSlaPoller();
  const notificationPruner = startNotificationPruner();

  // Graceful shutdown: clear background intervals before the process exits so
  // in-flight scans are not cut off mid-write and the event loop drains cleanly.
  const shutdown = (signal: string) => {
    logger.info({ signal }, "Graceful shutdown initiated");
    if (slaPoller) clearInterval(slaPoller);
    if (notificationPruner) clearInterval(notificationPruner);
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
