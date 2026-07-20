---
name: SMTP / email patterns
description: Patterns and pitfalls from the SMTP email feature implementation (nodemailer, digest mailer, migration).
---

# SMTP / email patterns

## Email client singleton
- `artifacts/api-server/src/lib/email.ts` — nodemailer transporter; reads `SMTP_HOST/PORT/SECURE/USER/PASS/FROM`; `APP_URL` for link construction.
- `isEmailConfigured()` returns `Boolean(SMTP_HOST)`; all callers use this to no-op gracefully.
- `sendMail` never throws — returns `{ ok: true } | { ok: false; error }`.

## Digest mailer
- `artifacts/api-server/src/lib/digest-mailer.ts` — hourly `setInterval`, 20h daily / 6d weekly gap.
- **Multi-org rule**: aggregate notifications across ALL orgs a user belongs to using `Map<userId, Array<{orgId,orgName}>>`. Single-org map (last-row-wins) silently drops notifications. Advance `lastSentAt` only after successful delivery.

## DB schema
- `lib/db/src/schema/email-digest.ts` — `emailDigestFrequencyEnum`, `emailDigestPreferencesTable` (per-user, unique on `userId`).
- Migration script: `lib/db/src/migrations/create-email-digest-preferences.ts` (idempotent, checks type + table existence).
- Run with: `pnpm --filter @workspace/db migrate:create-email-digest-preferences`.

## TypeScript narrowing trap in tests
- `const x = null` → TypeScript knows the literal value; truthy branch narrows to `never`, making `Date > never` a compile error.
- Fix: `const x = null as unknown as Date | null` to break literal narrowing.

**Why:** This showed up in digest-mailer multi-org tests when checking `lastSentAt` filter logic inline.
