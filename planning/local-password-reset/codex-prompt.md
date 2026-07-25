## Task

Add a self-service "forgot password" flow for local auth mode (`AUTH_MODE=local`) in Opsly. Today `artifacts/api-server/src/routes/auth.ts` only supports `/auth/local/login` and `/auth/local/register-invite` — there's no way for a user to recover a forgotten password.

Build:
1. A new DB table for password reset tokens.
2. Two new API routes: request a reset, and consume a reset token to set a new password.
3. Two new frontend pages: request-reset form, and set-new-password form.
4. A "Forgot password?" link on the existing login page, wired to the new request-reset page.

Only local-mode accounts (`usersTable.authProvider === 'local'`) can have passwords reset. Never reveal whether an email has an account.

## Acceptance Criteria

- A `passwordResetsTable` exists in `lib/db/src/schema/auth.ts` (same file as `sessionsTable`/`usersTable`), following the shape already used by `invitationsTable` in `lib/db/src/schema/organizations.ts`: `id` (uuid pk, `default(sql\`gen_random_uuid()\`)`), `userId` (varchar, FK to `usersTable.id`, `onDelete: 'cascade'`), `token` (varchar, unique, not null), `expiresAt` (timestamp with timezone, not null), `consumedAt` (timestamp with timezone, nullable — set when the token is used), `createdAt` (timestamp with timezone, not null, default now). Export `PasswordReset`/`InsertPasswordReset` types the same way the file already exports `User`/`UpsertUser`.
- `POST /auth/local/forgot-password` accepts `{ email: string }` (validate with an inline zod schema in `auth.ts`, following the exact pattern of `localLoginBodySchema` — do not add this to the OpenAPI spec / orval-generated schemas, since sibling local-auth endpoints already use hand-written inline zod schemas instead of generated ones).
  - If `getAuthMode() !== 'local'`, respond 400 the same way the other local-only routes do (see `router.post('/auth/local/login', ...)` for the exact early-return pattern).
  - Look up a user by lowercased email **and** `authProvider = 'local'`. Whether or not one is found, respond with the same 200 JSON body (e.g. `{ message: 'If an account exists for this email, a reset link has been sent.' }`) — the response must be indistinguishable in both cases (same status, same shape, same rough timing — don't skip the token-generation work on the "no user" path in a way that makes timing obviously different).
  - When a user is found: generate a random token (`crypto.randomBytes(32).toString('hex')`, matching the style of `createSession`'s sid generation in `lib/auth.ts` — not the HMAC-JWT style from `unsubscribe-token.ts`, since we want a single-use DB-tracked token here, not a stateless one), insert a `passwordResetsTable` row with `expiresAt` = now + 1 hour, and send an email via `sendMail` from `lib/email.ts` using a new `buildPasswordResetEmail()` template function added to that file, following the exact structure/styling (`STYLES`, `escapeHtml` on all interpolated values, wrapper/header/body/footer divs) of the existing `buildInviteEmail()`. Link format: `${APP_URL}/reset-password?token=<token>`.
  - Before inserting a new token, invalidate any previous unconsumed tokens for that user (delete them, or mark consumed — pick one and be consistent) so only the most recent reset link works.
- `POST /auth/local/reset-password` accepts `{ token: string, password: string }` (`password.min(8)`, matching `localInviteRegistrationBodySchema`'s rule).
  - Look up the token; if missing, already consumed, or `expiresAt` is in the past, respond 400 with an error message the frontend can show as "This reset link is invalid or has expired."
  - On success: hash the new password with `hashLocalPassword` from `lib/local-password.ts`, update `usersTable.passwordHash`, mark the reset row consumed (set `consumedAt`), and respond 200.
  - Do **not** attempt to invalidate the user's other active sessions as part of this task — `sessionsTable` has no `userId` column to query by (see `lib/db/src/schema/auth.ts`), so this is out of scope here (see Out of Scope).
- Login page (`artifacts/it-task-manager/src/pages/login.tsx`): add a "Forgot password?" link/button below the password form, visible only when `loginMethod === 'password'` (same condition already gating the local-login form). Link to a new `/forgot-password` route.
- New frontend page for requesting a reset (email input, submit, shows the generic success message) and a new frontend page for `/reset-password` (reads `token` from the query string the same way `login.tsx` reads `returnTo`, takes a new password + confirm field, submits, then redirects to `/login` on success with a brief success indicator). Follow the existing visual style of `login.tsx` (same layout shell, `Input`/`Button` components from `@/components/ui/*`, `useTranslation()` for all copy — add new keys to `en.json` and leave other locale files for a follow-up translation pass unless the task explicitly asks you to translate all of them).
- Both new routes are registered wherever `auth.ts`'s router is mounted (check `routes/index.ts`) — no change needed there if `auth.ts`'s router already covers the whole `/auth/*` and top-level auth paths, but verify.
- Add `zxcvbn`-free basic validation only (min length 8) — do not add a password strength meter or additional dependencies; that's out of scope.
- Tests: add a test file alongside the existing `auth`-related tests (check for an existing `auth.test.ts` or similar under `artifacts/api-server/src/routes/`; if none exists, create `password-reset.test.ts` next to `webhooks.test.ts` etc following the existing test style in that directory) covering: successful request+reset flow, unknown email returns same generic response, expired token rejected, already-consumed token rejected, wrong `AUTH_MODE` rejected.

## Relevant Files / Paths

- `lib/db/src/schema/auth.ts` — add `passwordResetsTable` here.
- `artifacts/api-server/src/routes/auth.ts` — add the two new routes; reuse `getAuthMode()`, `getSafeReturnTo`-style helpers, and the existing local-route patterns already in this file.
- `artifacts/api-server/src/lib/local-password.ts` — reuse `hashLocalPassword` (do not reimplement hashing).
- `artifacts/api-server/src/lib/email.ts` — add `buildPasswordResetEmail()` next to `buildInviteEmail()`/`buildSlaBreachEmail()`; reuse `sendMail`, `escapeHtml`, `STYLES`.
- `artifacts/it-task-manager/src/pages/login.tsx` — add the "Forgot password?" link; likely a `useAuth()` hook (from `@workspace/replit-auth-web`, used here already) needs a new method, or a direct fetch — check how `loginWithPassword` is implemented in that package and follow the same calling convention for the two new endpoints.
- `artifacts/it-task-manager/src/pages/invite-page.tsx` — closest existing example of a token-in-query-string + set-something form; model the new reset-password page's structure on this rather than starting from scratch.
- `artifacts/it-task-manager/src/i18n/locales/en.json` — add new translation keys under an `auth.*` namespace matching existing keys like `auth.signIn`, `auth.emailPlaceholder`.

## Standards to Follow

From `.agents/memory/`:
- **American spellings** (`american-spellings.md`): all new UI strings, comments, and identifiers use American English spelling.
- **API server build quirks** (`api-server-build-quirks.md`): if any new package is imported directly in `api-server` routes/lib (shouldn't be needed here — everything used is already a dependency), it must be added to `artifacts/api-server/package.json`, not just relied on transitively.
- **Post-merge procedure** (`post-merge-procedure.md`): this feature adds a new table via `drizzle-kit push` (no manual migration file needed) — just add the table to the schema file; the push step (already automated post-merge) applies the DDL.
- Do not touch `lib/api-spec/openapi.yaml` or run orval codegen for these two endpoints — follow the existing inline-zod-schema pattern already used by `/auth/local/login` and `/auth/local/register-invite` in the same file, to stay consistent with how this file already handles local-auth request validation.

## Out of Scope

- Changing password while already logged in (settings-page feature) — not part of this task.
- Invalidating a user's other active sessions on password reset — `sessionsTable` isn't indexed by user, so this needs a separate follow-up; don't add a `userId` column to `sessionsTable` as part of this task.
- Rate limiting / throttling the reset-request endpoint — flagged as a known gap, but implementing it is a separate task unless explicitly asked.
- A password-strength meter or additional validation libraries.
- Translating new UI strings into any locale other than `en.json`.
- Any change to OIDC/`replit_oidc` login behavior.
