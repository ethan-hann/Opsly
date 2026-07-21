---
name: Secret encryption utility
description: AES-256-GCM encryption for secrets stored in the database; naming conventions and API response rules.
---

# Secret Encryption in the Database

## Rule
All credentials and secrets stored in the database must be encrypted with the `encrypt`/`decrypt` utility in `artifacts/api-server/src/lib/encryption.ts` (AES-256-GCM, Node built-in `crypto`, no third-party deps).

**Why:** Plain-text secrets in the DB expose credentials if the DB is ever dumped. Symmetric encryption keyed from an env var (`SECRET_ENCRYPTION_KEY`) keeps secrets safe at rest while remaining usable by the server.

**How to apply:**
- Column naming convention: columns holding encrypted values end in `_encrypted` (e.g. `pass_encrypted`). This signals to future readers that the column stores ciphertext.
- The `SECRET_ENCRYPTION_KEY` environment variable must be set; the `encrypt()`/`decrypt()` functions throw a clear error at call time if it is absent.
- API responses must **never** include raw secrets. Expose only a `hasPassword` boolean (or equivalent) — never the plaintext or ciphertext.
- The ciphertext format is self-contained: `<iv_hex>:<authTag_hex>:<ciphertext_base64>` — no external state needed to decrypt.
- The key is always derived via SHA-256 of `SECRET_ENCRYPTION_KEY`, so any string length is accepted but longer is safer.
- First use: SMTP password stored in `instance_smtp_config.pass_encrypted`.
