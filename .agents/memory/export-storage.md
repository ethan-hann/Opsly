---
name: Export storage migration
description: How the durable export storage system works — StorageProvider abstraction, DB-backed job state, test patterns.
---

# Export Storage — Durable Object Storage

## Architecture

- `artifacts/api-server/src/lib/storage/provider.ts` — `StorageProvider` interface + `getStorageProvider()` factory (reads `STORAGE_DRIVER` env var)
- `artifacts/api-server/src/lib/storage/replit.ts` — GCS-backed impl (needs `DEFAULT_OBJECT_STORAGE_BUCKET_ID`)
- `artifacts/api-server/src/lib/storage/s3.ts` — S3-compatible impl (needs `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; optional `S3_ENDPOINT`)
- `lib/db/src/schema/export-jobs.ts` — `exportJobsTable` persists job state (id, orgId, userId, token, objectKey, status, filename, contentType, createdAt, expiresAt)

## Key decisions

**Why:** In-memory Maps were wiped on server restart. DB + object storage makes exports durable across restarts.

**How to apply:** `getStorageProvider()` is a lazy singleton — reads `STORAGE_DRIVER` once and caches. Use `require()` (not import) inside the factory to allow lazy loading of GCS/S3 SDKs.

**Export object key format:** `{orgId}/{userId}/{token}` — scoped to org+user, uses the download token as the unique suffix.

**TTL enforcement:** Both the route handler (checks `job.expiresAt < now`) and a 10-min cleanup setInterval (expires rows + deletes storage objects + purges rows > 24h old).

**Unique constraint on (userId, orgId):** When a new export is requested, the old job row is marked expired and its storage object deleted before the new job is created.

## Test pattern for mocking storage

In tests, mock `../lib/storage/provider` as a module returning a **singleton** mock object (not a new object per call), so spies on `put`/`get`/`delete` are observable after route calls:

```typescript
const mockStorageProvider = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn() }));
vi.mock("../lib/storage/provider", () => ({ getStorageProvider: () => mockStorageProvider }));
```

The db mock needs `insert`, `update`, `delete` chains in addition to `select`. Also mock `lt` and `or` from drizzle-orm.

## Packages added to api-server
- `@aws-sdk/client-s3`
- `@google-cloud/storage`
- `google-auth-library`
