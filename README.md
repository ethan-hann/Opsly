# Opsly

**A project and task manager that scales from solo use to full engineering teams.**

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue.svg)](LICENSE)
[![CI](https://github.com/ethan-hann/Opsly/actions/workflows/ci.yml/badge.svg)](https://github.com/ethan-hann/Opsly/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](.nvmrc)

Opsly is a self-hostable work-management platform. Start as a single user tracking
your own to-dos and grow into multi-team organizations with roles, workflows,
SLAs, and audit trails — without changing tools.

> **Source-available, not open source.** The code is public so you can read it,
> self-host it, and contribute, but it is licensed under the
> [Functional Source License](LICENSE) (see [License](#license) below). You may
> not use Opsly to build a competing product or service.

## Screenshots

| Dashboard — light | Dashboard — dark |
| :---: | :---: |
| ![Opsly dashboard in light mode](docs/screenshots/dashboard-light.png) | ![Opsly dashboard in dark mode](docs/screenshots/dashboard-dark.png) |

## Features

Opsly is under active development. The list below is a snapshot of what ships
today, not an exhaustive spec — more is in progress, and full versioned feature
docs will live on the project [documentation site](#documentation) as it's built out.

### What makes Opsly stand out

- 🌍 **Localized in 8 languages** out of the box — English, Spanish, French,
  German, Portuguese, Japanese, Chinese, and Arabic.
- 📴 **Offline-first** — keep working while disconnected; edits queue locally and
  sync automatically on reconnect, with a live pending-sync indicator on cards.
- ⛓️ **Dependency Trees** - model and enforce dependencies between tasks.
- ⚡ **Real-time updates** — notifications and cross-org changes stream live over
  Server-Sent Events, no page refresh needed.
- ✍️ **Rich Markdown editor** with **Mermaid diagram** rendering for notes, task
  descriptions, and project descriptions.
- 🔑 **API keys with scoped permissions** for automation and programmatic access.
- 🎨 **Custom branding** — per-organization brand color and logo.
- 🏠 **Self-hostable** with pluggable object storage (local disk or S3-compatible).

### Core work management

- **Projects & tasks** with priorities, assignees, custom fields, and history.
- **Workflows** — configurable stages that tasks move through.
- **Organizations & roles** — multi-tenant orgs with granular, per-role permissions (RBAC).
- **Dashboards & Kanban** views for status at a glance.
- **SLA tracking** with compliance windows and overshoot reporting.
- **Webhooks** for integrating Opsly events with your own systems.
- **Audit trail** of changes across tasks and organizations.
- **Notifications & email digests** for the events that matter to each user.
- **Instance admin & feature flags** to roll capabilities out gradually.

## Tech stack

A [pnpm](https://pnpm.io) monorepo on **Node 24**:

- **Backend** — Express + [Drizzle ORM](https://orm.drizzle.team) on PostgreSQL (`artifacts/api-server`).
- **Frontend** — React + Vite (`artifacts/it-task-manager`).
- **Typed API contract** — `lib/api-spec/openapi.yaml` is the source of truth;
  `lib/api-zod` (validators) and `lib/api-client-react` (React Query client) are
  generated from it.

## Quick start (local development)

Run these in the same shell session:

```bash
pnpm install                                              # Node 24 (see .nvmrc)
docker compose -f docker-compose.local.yml up db -d       # start Postgres
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/opsly"
pnpm run setup                                            # push schema + seed admin@example.com / changeme
pnpm run dev                                              # api-server + frontend
```

On Windows PowerShell, set the variable with
`$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5432/opsly"`.

If you recreate the local Postgres volume, run `pnpm run setup` again before
`pnpm run dev`. More detail is in [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md).

## Documentation

Project documentation lives in [`docs/`](docs/):

- [**Self-Hosting Guide**](docs/SELF_HOSTING.md) — run Opsly in production, from a
  single VPS (Docker Compose + a reverse proxy) to distributed/HA deployments.
- [**Local Development**](docs/LOCAL_DEV.md) — full local setup beyond the quick start.

A dedicated documentation site that builds from `docs/` is planned to live in
this repo.

## Contributing

Contributions are welcome under a **deliberately strict, issue-first process**.
Before writing any code, please read [`CONTRIBUTING.md`](CONTRIBUTING.md) — in
short:

1. Open an issue and get maintainer agreement on the approach first. Unsolicited
   large PRs are declined.
2. Sign off your commits (`git commit -s`) and agree to the [CLA](CLA.md).
3. Ship tests with your change; CI (typecheck, build, coverage gate, DB tests)
   must be green.

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md). To
report a security issue, follow [`SECURITY.md`](SECURITY.md) — never a public issue.

## License

Opsly is licensed under the **Functional Source License, Version 1.1, ALv2
Future License (FSL-1.1-ALv2)** — see [`LICENSE`](LICENSE).

What this means in practice:

- ✅ You may use, copy, modify, and self-host Opsly for any purpose **except a
  Competing Use** — you can't use it to build or offer a product/service that
  substitutes for Opsly or offers substantially similar functionality.
- ✅ Internal business use, non-commercial education/research, and professional
  services for licensees are explicitly permitted.
- 🕓 Each release automatically converts to the **Apache License 2.0** two years
  after it is published.

For commercial licensing or a use the FSL doesn't permit, open a
[discussion](https://github.com/ethan-hann/Opsly/discussions).

Copyright © 2026 Ethan Hann.
