# Self-Hosting Guide — API Server

This document covers every environment variable the API server reads at
startup, with the full list of required and optional values for each
storage driver.

---

## Object Storage

The data-export feature writes export files to object storage so they
survive server restarts and scale beyond a single process.  Choose one
driver by setting `STORAGE_DRIVER`.

### STORAGE_DRIVER=replit (default)

Used when running on [Replit](https://replit.com).  Backed by Google Cloud
Storage via the Replit sidecar — no GCP service-account key is needed.

**Required**

| Variable | Description |
|---|---|
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Bucket ID from the Replit Object Storage tool (shown in the Replit console). |

**Optional**

| Variable | Default | Description |
|---|---|---|
| `STORAGE_PREFIX` | `exports/` | Key prefix applied to every export object. Change only if you share the bucket with other workloads. |

**Setup steps**

1. Open the Replit console → **Object Storage** → create a bucket.
2. Copy the bucket ID and add it as a secret named `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.
3. Start (or restart) the API server.  The startup log will confirm:
   ```
   {"driver":"replit","bucket":"<id>","prefix":"exports/","msg":"Storage driver ready"}
   ```

---

### STORAGE_DRIVER=s3

Compatible with AWS S3, MinIO, Cloudflare R2, Backblaze B2, and any
other S3-compatible endpoint.

**Required**

| Variable | Description |
|---|---|
| `S3_BUCKET` | Bucket name. |
| `S3_REGION` | AWS region (e.g. `us-east-1`). Required even for non-AWS endpoints. |
| `S3_ACCESS_KEY_ID` | IAM / service-account access key ID. |
| `S3_SECRET_ACCESS_KEY` | IAM / service-account secret access key. **Never logged.** |

**Optional**

| Variable | Default | Description |
|---|---|---|
| `S3_ENDPOINT` | *(AWS default)* | Custom endpoint URL for non-AWS providers (e.g. `https://s3.eu-west-003.backblazeb2.com`, `http://localhost:9000` for local MinIO). Omit for AWS S3. |
| `STORAGE_PREFIX` | `exports/` | Key prefix applied to every export object. Scopes all export data inside a shared bucket and prevents the storage audit from touching unrelated objects. |

**Setup steps**

1. Create an S3 bucket and an IAM user (or service account) with
   `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:HeadObject`,
   and `s3:ListBucket` permissions on the bucket.
2. Set the required environment variables (use secrets in production —
   never commit credentials to source control).
3. Set `STORAGE_DRIVER=s3`.
4. Start (or restart) the API server.  The startup log will confirm:
   ```
   {"driver":"s3","bucket":"<name>","region":"<region>","endpoint":"(AWS default)","prefix":"exports/","msg":"Storage driver ready"}
   ```

**Misconfiguration error**

If any required variable is missing the server logs a FATAL message
listing each variable as `"set"` or `"missing"` (actual values are never
logged) and exits immediately with code 1:

```
{"driver":"s3","required":[{"name":"S3_BUCKET","status":"missing"},...],"msg":"Storage misconfigured: STORAGE_DRIVER=s3 requires S3_BUCKET, ..."}
```

The `fixGuide` field in the same log entry lists every variable with a
one-line description of what to set.

---

## Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`postgres://user:pass@host/db`). |

---

## Authentication

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Secret used to sign session cookies. Must be long (≥ 32 chars) and random. |
| `INSTANCE_ADMIN_TOKEN` | Bearer token that grants instance-admin access for initial setup. Set on first deploy; rotate or remove after creating your first admin account. |

---

## Email (optional)

Set these to enable password-reset, notification, and digest emails.  If
omitted the server runs without email support.

| Variable | Description |
|---|---|
| `SMTP_HOST` | SMTP server hostname (e.g. `smtp.sendgrid.net`). |
| `SMTP_PORT` | SMTP port (default `587`). |
| `SMTP_USER` | SMTP username. |
| `SMTP_PASS` | SMTP password / API key. |
| `SMTP_FROM` | "From" address (e.g. `noreply@example.com`). |

---

## Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | *(required)* | Port the HTTP server listens on. |
| `NODE_ENV` | `development` | Set to `production` in deployed environments. |
