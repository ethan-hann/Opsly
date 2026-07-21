/**
 * Email client — nodemailer-based SMTP transporter.
 *
 * Configuration is read from environment variables:
 *   SMTP_HOST     — mail server hostname
 *   SMTP_PORT     — port (default 587)
 *   SMTP_SECURE   — "true" for TLS/SSL (port 465), "false" for STARTTLS
 *   SMTP_USER     — SMTP auth username
 *   SMTP_PASS     — SMTP auth password
 *   SMTP_FROM     — sender address, e.g. "IT Tasks <noreply@example.com>"
 *   APP_URL       — base URL of the frontend, used in email links
 *
 * When SMTP_HOST is unset, sendMail is a silent no-op and the app runs
 * without email capability. All callers must handle this gracefully.
 */

import nodemailer from "nodemailer";
import { logger } from "./logger";

// ─── Configuration ────────────────────────────────────────────────────────────

const SMTP_HOST = process.env["SMTP_HOST"] ?? "";
const SMTP_PORT = Number(process.env["SMTP_PORT"] ?? "587");
const SMTP_SECURE = process.env["SMTP_SECURE"] === "true";
const SMTP_USER = process.env["SMTP_USER"] ?? "";
const SMTP_PASS = process.env["SMTP_PASS"] ?? "";
const SMTP_FROM = process.env["SMTP_FROM"] ?? "IT Task Manager <noreply@example.com>";

/** Returns true when SMTP has been configured. */
export function isEmailConfigured(): boolean {
  return Boolean(SMTP_HOST);
}

/** Returns a sanitized config snapshot (no password) for status display. */
export function getEmailConfig(): {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
} {
  return {
    configured: isEmailConfigured(),
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    user: SMTP_USER,
    from: SMTP_FROM,
  };
}

// ─── Transporter (lazy singleton) ─────────────────────────────────────────────

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      ...(SMTP_USER && SMTP_PASS
        ? { auth: { user: SMTP_USER, pass: SMTP_PASS } }
        : {}),
    });
  }
  return _transporter;
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
      from: SMTP_FROM,
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
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header"><h1>IT Task Manager</h1></div>
  <div class="body">
    <h2>You've been invited to join ${opts.orgName}</h2>
    <p>${opts.inviterName} has invited you to join their organization on IT Task Manager.</p>
    <a class="cta" href="${opts.inviteLink}">Accept invitation</a>
    <p style="color:#6b7280;font-size:13px;">This invitation expires on ${expires}. If you did not expect this email, you can safely ignore it.</p>
  </div>
  <div class="footer">IT Task Manager · This is an automated message.</div>
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
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header"><h1>IT Task Manager — SLA Breach Alert</h1></div>
  <div class="body">
    <h2>SLA breach: ${opts.taskTitle}</h2>
    <p>A task you are watching in <strong>${opts.orgName}</strong> has exceeded its SLA deadline.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#6b7280;width:120px">Task</td><td><strong>${opts.taskTitle}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Priority</td><td style="text-transform:capitalize">${opts.priority}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Breached at</td><td>${breachedStr}</td></tr>
    </table>
    <a class="cta" href="${opts.taskUrl}">View task</a>
  </div>
  <div class="footer">IT Task Manager · This is an automated SLA alert.</div>
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
  const items = opts.notifications
    .map((n) => {
      const time = n.createdAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
      const url = `${opts.appUrl}/tasks/${n.entityId}`;
      return `<div class="notification-item">
        <p><a href="${url}" style="color:#2563eb;text-decoration:none">${n.message}</a></p>
        <p class="time">${time}</p>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>${STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header"><h1>IT Task Manager — ${period.charAt(0).toUpperCase() + period.slice(1)} digest</h1></div>
  <div class="body">
    <h2>Hi ${opts.userName},</h2>
    <p>Here's your ${period} notification digest for <strong>${opts.orgName}</strong>. You have ${opts.notifications.length} unread notification${opts.notifications.length !== 1 ? "s" : ""}.</p>
    <div style="margin:24px 0">${items}</div>
    <a class="cta" href="${opts.appUrl}">Open IT Task Manager</a>
    <p style="color:#6b7280;font-size:13px;margin-top:24px">
      You're receiving this because you opted into ${period} email digests.
      <a href="${opts.appUrl}/settings/notifications" style="color:#2563eb">Manage preferences</a>
      &nbsp;·&nbsp;
      <a href="${opts.unsubscribeUrl}" style="color:#2563eb">Unsubscribe</a>
    </p>
  </div>
  <div class="footer">IT Task Manager · This is an automated digest. <a href="${opts.unsubscribeUrl}" style="color:#6b7280">Unsubscribe from digest emails</a></div>
</div>
</body>
</html>`;
}
