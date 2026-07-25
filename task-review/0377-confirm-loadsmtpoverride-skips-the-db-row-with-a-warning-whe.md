# #377 — Confirm loadSmtpOverride skips the DB row (with a warning) when passEncrypted exists but decryption fails due to a rotated key

**State:** PROPOSED
**Depends on:** #316

---

# Confirm loadSmtpOverride skips the DB row when decryption fails due to a rotated key

## What & Why
loadSmtpOverride now exits fatally when SECRET_ENCRYPTION_KEY is absent. A subtler failure is when the key IS set but was rotated after the password was encrypted — decrypt() throws an auth-tag error. The inner try/catch logs an error and returns (falls back to env vars). There is no test confirming this degradation path, so a regression that swallowed the error silently or crashed the server would go undetected.

## Done looks like
- artifacts/api-server/src/lib/email-key-missing.test.ts (or a new file) gains a test for the rotated-key case
- SECRET_ENCRYPTION_KEY is set to a key that differs from the one used to produce the ciphertext
- Test asserts: loadSmtpOverride resolves (no crash), logger.error is called with the decrypt error, process.exit is NOT called

## Relevant files
- artifacts/api-server/src/lib/email.ts (loadSmtpOverride, lines ~140-157)
- artifacts/api-server/src/lib/email-key-missing.test.ts
