# Self-Service Password Reset (Local Auth Mode)

## Problem / Goal
When `AUTH_MODE=local`, users authenticate with email + password (`/auth/local/login`). There is currently no recovery path if a user forgets their password — the only routes are login and invite-based registration (`auth.ts`). This adds a standard "Forgot password?" flow so local-mode users can reset their own password via a signed, expiring, single-use email link, without needing an admin to intervene.

This only applies when `AUTH_MODE=local`. OIDC-mode orgs (`replit_oidc` / `oidc`) don't store a `passwordHash` at all, so password reset is meaningless for them and must stay disabled.

## Scope
**In:**
- "Forgot password?" link on the login page, shown only when `loginMethod === 'password'` (i.e. local mode) — matches how the existing form already branches on `loginMethod` in `login.tsx`.
- A request-reset form (email only) that always returns a generic success message regardless of whether the account exists, to avoid leaking which emails have accounts.
- A signed, single-use, time-limited reset token emailed to the user (only if a `local`-provider account with that email exists).
- A "set new password" page that accepts the token + new password (reusing the existing min-8-character rule already enforced at invite registration) and updates `passwordHash` via the existing `hashLocalPassword` helper.
- Reset tokens are single-use: once consumed, or once a new reset is requested, prior tokens for that user stop working.

**Out (flag for later, not this pass):**
- Changing your password while already logged in (a settings-page feature) — no such feature exists today; this plan only covers the "forgot it" path.
- Rate limiting / brute-force protection beyond what's described in Open Questions below.
- Invalidating other active sessions when a password is reset (see Open Questions — the current session store doesn't make this cheap).
- Any change to OIDC login.

## User Stories
- As a local-mode user who forgot my password, I can click "Forgot password?" on the login page, enter my email, and receive a reset link if an account exists — without being told whether it exists.
- As that user, clicking the link within its validity window lets me set a new password and log in with it.
- As that same user, if I click an old/expired/already-used reset link, I see a clear "this link is no longer valid" message and can request a new one.

## Open Questions / Risks
1. **Session invalidation on reset.** `sessionsTable` stores sessions keyed by `sid` with the session payload in an opaque `sess` JSON blob (`lib/db/src/schema/auth.ts`) — there's no `userId` column to query by. Invalidating a user's *other* active sessions when their password resets would require either scanning/filtering JSON sessions by embedded user id (slow, fragile) or adding a `userId` column to `sessionsTable`. Recommend treating this as an explicit follow-up rather than blocking this feature on it — flagging so it's a conscious choice, not an oversight.
2. **Reset token delivery requires SMTP configured.** Per `email.ts`, `sendMail` silently no-ops when SMTP isn't configured. In that case the "check your email" message would be shown but no email would actually arrive. Worth deciding whether request-reset should surface a distinct (admin-facing, not user-facing) log/warning when this happens — recommend yes, logged only, user-facing message stays generic either way.
3. **Rate limiting.** Nothing in this codebase currently rate-limits auth endpoints. A reset-request endpoint that fans out email sends per-request is a mild abuse vector (mail-bombing an address). Recommend a light per-email/per-IP throttle at minimum; exact mechanism (in-memory vs DB) is a small enough decision to leave to implementation, but it should not be skipped entirely.
4. **Token lifetime.** Recommend 1 hour (shorter than the 30-day unsubscribe token or 7-day invite token, since this grants account takeover if intercepted). Confirm 1 hour is acceptable — easy to change later.
