# Opsly

## Local development (native)

Run these commands in the same shell session:

1. Use Node 24 from the repo root `.nvmrc`.
2. Run `pnpm install`.
3. Start Postgres with `docker compose -f docker-compose.local.yml up db -d`.
4. Set `DATABASE_URL` to `postgres://postgres:postgres@localhost:5432/opsly`.
   - PowerShell: `$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/opsly"`
   - bash / sh: `export DATABASE_URL="postgres://postgres:postgres@localhost:5432/opsly"`
5. Run `pnpm run setup` to push the schema and seed `admin@example.com` / `changeme`.
6. Run `pnpm run dev`.

If you recreate the local Postgres volume or start from a fresh database, run `pnpm run setup` again before `pnpm run dev`.

See `LOCAL_DEV.md` for more local development details.

