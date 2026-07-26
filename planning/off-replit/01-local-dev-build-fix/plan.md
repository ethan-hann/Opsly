# 01 — Local Dev Build Fix + Node Pin

> Part of the [Off-Replit program](../roadmap.md). No dependencies; do this first — it unblocks native local dev.

## Problem / Goal

Native (non-Docker) `pnpm run dev` crashes the api-server at startup with:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../uuid@14.0.1/dist-node/index.js
from .../gaxios@6.7.1/build/src/gaxios.js not supported.
```

Docker works, native doesn't — the trap that makes contributors distrust the native path. Two independent root causes; fix both.

1. **Unbounded `uuid` override (the correctness bug).** `pnpm-workspace.yaml` sets `overrides.uuid: ">=11.1.1"`. Intended as a security *minimum*, but unbounded `>=` floats every `uuid` in the tree to the newest major — currently **14.0.1**, which is **ESM-only**. `@google-cloud/storage@^7.21.0` (a direct `api-server` dep) pulls in **gaxios@6.7.1**, a CommonJS package that does `require("uuid")` (`gaxios.js:63`). `build.mjs` externalizes `@google-cloud/*`, so gaxios stays a runtime `require`. CJS `require()` of an ESM-only module fails.

2. **No pinned Node version (the parity bug).** Local machine runs **Node 22.11.0**. `require(ESM)` only became unflagged in **Node 22.12.0**; Docker (`node:24`) and Replit (`nodejs-24`) run Node 24, so they tolerate what breaks locally. Nothing (`.nvmrc`/`engines`/`packageManager`) pins the version or fails fast on a wrong one.

## Scope

**In scope:**
- Bound the `uuid` override to `>=11.1.1 <13` (allows 11.x and 12.x — both ship a CommonJS entry — blocks the ESM-only 13/14 majors; preserves the `>= 11.1.1` security floor).
- Pin Node to 24 (`.nvmrc`, `engines.node`, `packageManager`) so native dev matches Docker/Replit.
- Fail fast on wrong Node via the existing `scripts/preinstall.js` guard (already enforces pnpm).
- Make `wait-for-api.mjs`'s timeout message actionable (point at the `[api]` logs).
- Faster api-server inner loop: replace the one-shot `build && start` dev script with an esbuild `context()`/`watch()` loop that rebuilds + restarts on change, with the esbuild config extracted into one shared module so the watch and prod builds can't drift. No new dependencies.
- Document the native setup sequence in the README.

**Out of scope (later plans / not now):**
- CI migration and the boot smoke check → **Plan 02**.
- Any Replit code removal → **Plans 03–05**.
- Changing the esbuild externalization strategy, or upgrading `@google-cloud/storage` / `google-auth-library` majors.
- Frontend Vite HMR (already works).

## User Stories

- **As a contributor on a fresh clone (Node 24),** I can run the documented setup and `pnpm run dev`, and both api and web come up — no `ERR_REQUIRE_ESM`.
- **As a contributor on the wrong Node,** `pnpm install` fails fast telling me which Node to use, instead of a runtime crash 60s into `pnpm run dev`.
- **As a contributor editing api-server code,** saving a `.ts` file rebuilds and restarts the server automatically — no manual restart, no full cold-rebuild loop.
- **As a maintainer,** the `uuid` override still enforces `>= 11.1.1` but can't float to an ESM-only major that breaks CJS dependents.

## Open Questions / Risks

- **uuid bound (decided):** `>=11.1.1 <13` per Ethan. Must carry an inline comment explaining the `<13` bound is intentional (13+ is ESM-only, breaks CJS `gaxios@6`), so nobody re-widens it.
- **Watch-loop config drift:** the one real hazard — mitigated by extracting the esbuild options (esp. the `external` list) into a single shared module imported by both `build.mjs` and the watch entry. No watcher package (that would also fight `minimumReleaseAge`).
- **`minimumReleaseAge`:** bounding uuid re-resolves to a long-published 11.x/12.x version; no allowlist change expected.
