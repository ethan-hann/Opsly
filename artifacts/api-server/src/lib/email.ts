/**
 * Email client — nodemailer-based SMTP transporter.
 *
 * Configuration is read from environment variables at startup:
 *   SMTP_HOST     — mail server hostname
 *   SMTP_PORT     — port (default 587)
 *   SMTP_SECURE   — "true" for TLS/SSL (port 465), "false" for STARTTLS
 *   SMTP_USER     — SMTP auth username
 *   SMTP_PASS     — SMTP auth password
 *   SMTP_FROM     — sender address, e.g. "Opsly <noreply@example.com>"
 *   APP_URL       — base URL of the frontend, used in email links
 *
 * A DB override (instance_smtp_config row) silently wins over env vars at
 * runtime. Call loadSmtpOverride() on startup (after DB is ready) to apply
 * any existing override, and applySmtpOverride() / clearSmtpOverride() from
 * admin routes to change the live config without a restart.
 *
 * The SMTP password is never returned in any API response or log — only a
 * boolean `hasPassword` is exposed.
 *
 * When SMTP_HOST is unset (and no DB override is active), sendMail is a
 * silent no-op and the app runs without email capability.
 */

import nodemailer from "nodemailer";
import { logger } from "./logger";
import { encrypt, decrypt } from "./encryption";
import { db, instanceSmtpConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── HTML escaping ────────────────────────────────────────────────────────────

/**
 * Escape user-supplied strings before interpolating them into HTML email
 * templates.  Prevents display names, task titles, org names, and notification
 * messages from injecting markup into the email body.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Env-var defaults (immutable after startup) ───────────────────────────────

const ENV_CONFIG = {
  host: process.env["SMTP_HOST"] ?? "",
  port: Number(process.env["SMTP_PORT"] ?? "587"),
  secure: process.env["SMTP_SECURE"] === "true",
  user: process.env["SMTP_USER"] ?? "",
  pass: process.env["SMTP_PASS"] ?? "",
  from: process.env["SMTP_FROM"] ?? "Opsly <noreply@example.com>",
};

// ─── Mutable runtime config ───────────────────────────────────────────────────

interface SmtpRuntimeConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Plain-text password for the transporter — never exposed in API responses. */
  pass: string;
  from: string;
  /** Where the active config came from. */
  source: "env" | "db";
}

let _config: SmtpRuntimeConfig = {
  ...ENV_CONFIG,
  source: "env",
};

// ─── Transporter ─────────────────────────────────────────────────────────────

let _transporter: nodemailer.Transporter | null = null;

function buildTransporter(cfg: SmtpRuntimeConfig): nodemailer.Transporter | null {
  if (!cfg.host) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  });
}

function refreshTransporter(): void {
  _transporter = buildTransporter(_config);
}

function getTransporter(): nodemailer.Transporter | null {
  if (!_config.host) return null;
  if (!_transporter) {
    _transporter = buildTransporter(_config);
  }
  return _transporter;
}

// ─── Public config API ────────────────────────────────────────────────────────

/** Returns true when SMTP has been configured. */
export function isEmailConfigured(): boolean {
  return Boolean(_config.host);
}

/**
 * Returns a sanitized config snapshot — no password, only `hasPassword`.
 * Includes `source` ("env" | "db") so the UI can show the appropriate badge.
 */
export function getEmailConfig(): {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  source: "env" | "db";
  hasPassword: boolean;
} {
  return {
    configured: isEmailConfigured(),
    host: _config.host,
    port: _config.port,
    secure: _config.secure,
    user: _config.user,
    from: _config.from,
    source: _config.source,
    hasPassword: Boolean(_config.pass),
  };
}

// ─── DB override lifecycle ────────────────────────────────────────────────────

/**
 * Read the instance_smtp_config row from the DB and, if present, merge it
 * over the env-var defaults. Call once at server startup (after DB is ready).
 */
export async function loadSmtpOverride(): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(instanceSmtpConfigTable)
      .where(eq(instanceSmtpConfigTable.id, "default"))
      .limit(1);

    if (!row) {
      logger.debug("No SMTP DB override found — using environment variables");
      return;
    }

    let pass = "";
    if (row.passEncrypted) {
      // Fail fast if the encryption key is missing — attempting to decrypt
      // without it would silently fall back to no password, which is worse
      // than a clear startup failure.
      if (!process.env["SECRET_ENCRYPTION_KEY"]) {
        logger.fatal(
          "FATAL: instance_smtp_config row exists with an encrypted password but " +
            "SECRET_ENCRYPTION_KEY is not set. The server cannot safely load the SMTP " +
            "override without the encryption key. Set SECRET_ENCRYPTION_KEY and restart.",
        );
        process.exit(1);
      }
      try {
        pass = decrypt(row.passEncrypted);
      } catch (err) {
        logger.error({ err }, "Failed to decrypt SMTP password from DB — ignoring override");
        return;
      }
    }

    _config = {
      host: row.host,
      port: Number(row.port),
      secure: row.secure,
      user: row.user,
      pass,
      from: row.fromAddress,
      source: "db",
    };
    refreshTransporter();
    logger.info("SMTP config loaded from DB override");
  } catch (err) {
    logger.error({ err }, "Failed to load SMTP override from DB — using environment variables");
  }
}

/**
 * Persist a new SMTP config to the DB and apply it immediately.
 * `pass` is optional — if omitted the existing password (if any) is retained.
 */
export async function applySmtpOverride(config: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  from: string;
}): Promise<void> {
  // Determine the password to store: use the new value if supplied, otherwise
  // re-encrypt the current in-memory password (which came from the existing DB
  // row or env vars).
  const plainPass = config.pass !== undefined ? config.pass : _config.pass;

  // Guard before encrypting — give the caller a descriptive error rather than
  // a raw crypto throw that surfaces as an opaque 500.
  if (plainPass && !process.env["SECRET_ENCRYPTION_KEY"]) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY is not set. Cannot encrypt the SMTP password. " +
        "Set the SECRET_ENCRYPTION_KEY environment variable and restart the server.",
    );
  }

  const passEncrypted = plainPass ? encrypt(plainPass) : null;

  await db
    .insert(instanceSmtpConfigTable)
    .values({
      id: "default",
      host: config.host,
      port: String(config.port),
      secure: config.secure,
      user: config.user,
      passEncrypted,
      fromAddress: config.from,
    })
    .onConflictDoUpdate({
      target: instanceSmtpConfigTable.id,
      set: {
        host: config.host,
        port: String(config.port),
        secure: config.secure,
        user: config.user,
        passEncrypted,
        fromAddress: config.from,
        updatedAt: new Date(),
      },
    });

  _config = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    pass: plainPass,
    from: config.from,
    source: "db",
  };
  refreshTransporter();
  logger.info({ host: config.host, port: config.port }, "SMTP config updated via admin override");
}

/**
 * Delete the DB override row and revert to env-var values immediately.
 */
export async function clearSmtpOverride(): Promise<void> {
  await db
    .delete(instanceSmtpConfigTable)
    .where(eq(instanceSmtpConfigTable.id, "default"));

  _config = {
    ...ENV_CONFIG,
    source: "env",
  };
  refreshTransporter();
  logger.info("SMTP DB override cleared — reverted to environment variables");
}

// ─── sendMail ─────────────────────────────────────────────────────────────────

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an email via the configured SMTP transporter.
 *
 * Returns { ok: true } on success, { ok: false, error } when SMTP is not
 * configured or delivery fails. Never throws.
 */
export async function sendMail(
  opts: MailOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.debug({ to: opts.to }, "Email skipped — SMTP not configured");
    return { ok: false, error: "SMTP not configured" };
  }

  try {
    await transporter.sendMail({
      from: _config.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    logger.info({ to: opts.to, subject: opts.subject }, "Email sent");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: opts.to }, "Email delivery failed");
    return { ok: false, error: message };
  }
}

// ─── HTML Templates ───────────────────────────────────────────────────────────

const STYLES = `
  body { margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrapper { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; }
  .header { background: #1d1d1f; padding: 24px 32px; }
  .header h1 { color: #fff; font-size: 20px; margin: 0; font-weight: 600; }
  .body { padding: 32px; color: #374151; font-size: 15px; line-height: 1.6; }
  .body h2 { font-size: 18px; margin-top: 0; color: #111827; }
  .cta { display: inline-block; margin: 24px 0; padding: 12px 24px; background: #2563eb; color: #fff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; }
  .footer { padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; }
  .notification-item { padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
  .notification-item:last-child { border-bottom: none; }
  .notification-item p { margin: 0; }
  .notification-item .time { color: #9ca3af; font-size: 12px; margin-top: 4px; }
`;

/**
 * Build the org-invite HTML email.
 */
export function buildInviteEmail(opts: {
  orgName: string;
  inviterName: string;
  inviteLink: string;
  expiresAt: Date;
}): string {
  const expires = opts.expiresAt.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const orgName = escapeHtml(opts.orgName);
  const inviterName = escapeHtml(opts.inviterName);
  const inviteLink = escapeHtml(opts.inviteLink);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header"><h1>Opsly</h1></div>
  <div class="body">
    <h2>You've been invited to join ${orgName}</h2>
    <p>${inviterName} has invited you to join their organization on Opsly.</p>
    <a class="cta" href="${inviteLink}">Accept invitation</a>
    <p style="color:#6b7280;font-size:13px;">This invitation expires on ${expires}. If you did not expect this email, you can safely ignore it.</p>
  </div>
  <div class="footer">Opsly · This is an automated message.</div>
</div>
</body>
</html>`;
}

/**
 * Build the SLA breach alert HTML email.
 */
export function buildSlaBreachEmail(opts: {
  orgName: string;
  taskTitle: string;
  taskUrl: string;
  priority: string;
  breachedAt: Date;
}): string {
  const breachedStr = opts.breachedAt.toLocaleString("en-US", {
    dateStyle: "medium", timeStyle: "short",
  });
  const orgName = escapeHtml(opts.orgName);
  const taskTitle = escapeHtml(opts.taskTitle);
  const taskUrl = escapeHtml(opts.taskUrl);
  const priority = escapeHtml(opts.priority);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header"><h1>Opsly — SLA Breach Alert</h1></div>
  <div class="body">
    <h2>SLA breach: ${taskTitle}</h2>
    <p>A task you are watching in <strong>${orgName}</strong> has exceeded its SLA deadline.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#6b7280;width:120px">Task</td><td><strong>${taskTitle}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Priority</td><td style="text-transform:capitalize">${priority}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Breached at</td><td>${breachedStr}</td></tr>
    </table>
    <a class="cta" href="${taskUrl}">View task</a>
  </div>
  <div class="footer">Opsly · This is an automated SLA alert.</div>
</div>
</body>
</html>`;
}

/**
 * Build the password reset HTML email.
 */
export function buildPasswordResetEmail(opts: {
  resetLink: string;
}): string {
  const resetLink = escapeHtml(opts.resetLink);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header"><h1>Opsly</h1></div>
  <div class="body">
    <h2>Reset your password</h2>
    <p>We received a request to reset the password for your Opsly account. Click the button below to choose a new password.</p>
    <a class="cta" href="${resetLink}">Reset password</a>
    <p style="color:#6b7280;font-size:13px;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email — your password will not change.</p>
  </div>
  <div class="footer">Opsly · This is an automated message.</div>
</div>
</body>
</html>`;
}

/**
 * Build the notification digest HTML email.
 */
export function buildDigestEmail(opts: {
  orgName: string;
  userName: string;
  notifications: Array<{ message: string; createdAt: Date; entityType: string; entityId: number }>;
  appUrl: string;
  frequency: "daily" | "weekly";
  unsubscribeUrl: string;
}): string {
  const period = opts.frequency === "daily" ? "daily" : "weekly";
  const userName = escapeHtml(opts.userName);
  const orgName = escapeHtml(opts.orgName);
  const appUrl = escapeHtml(opts.appUrl);
  const unsubscribeUrl = escapeHtml(opts.unsubscribeUrl);
  const items = opts.notifications
    .map((n) => {
      const time = n.createdAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
      // entityId is a number (integer), safe to interpolate directly.
      const url = `${appUrl}/tasks/${n.entityId}`;
      const message = escapeHtml(n.message);
      return `<div class="notification-item">
        <p><a href="${url}" style="color:#2563eb;text-decoration:none">${message}</a></p>
        <p class="time">${time}</p>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header"><h1>Opsly — ${period.charAt(0).toUpperCase() + period.slice(1)} digest</h1></div>
  <div class="body">
    <h2>Hi ${userName},</h2>
    <p>Here's your ${period} notification digest for <strong>${orgName}</strong>. You have ${opts.notifications.length} unread notification${opts.notifications.length !== 1 ? "s" : ""}.</p>
    <div style="margin:24px 0">${items}</div>
    <a class="cta" href="${appUrl}">Open Opsly</a>
    <p style="color:#6b7280;font-size:13px;margin-top:24px">
      You're receiving this because you opted into ${period} email digests.
      <a href="${appUrl}/settings/notifications" style="color:#2563eb">Manage preferences</a>
      &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color:#2563eb">Unsubscribe</a>
    </p>
  </div>
  <div class="footer">Opsly · This is an automated digest. <a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe from digest emails</a></div>
</div>
</body>
</html>`;
}
