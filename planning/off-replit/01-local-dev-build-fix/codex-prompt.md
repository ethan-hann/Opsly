# Codex Prompt 01 — Fix native local-dev `ERR_REQUIRE_ESM`, pin Node, faster api-server loop

## Task

Native (non-Docker) local development of Opsly is broken. `pnpm run dev` builds the api-server, then crashes it immediately with:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module
  node_modules/.pnpm/uuid@14.0.1/node_modules/uuid/dist-node/index.js
  from node_modules/.pnpm/gaxios@6.7.1/node_modules/gaxios/build/src/gaxios.js not supported.
```

There are two root causes; fix both, plus three dev-experience improvements.

1. **Bound the `uuid` override.** In `pnpm-workspace.yaml`, the `overrides` block (under the "Security overrides" comment, near the `js-yaml` override) has `uuid: ">=11.1.1"`. The unbounded `>=` floats every `uuid` in the tree to the newest major — currently `14.0.1`, which is **ESM-only**. `@google-cloud/storage` (a direct dependency of `artifacts/api-server`) pulls in `gaxios@6.7.1`, a CommonJS package that does `require("uuid")` at runtime; `artifacts/api-server/build.mjs` externalizes `@google-cloud/*`, so gaxios stays a runtime `require`, and CJS `require()` of an ESM-only module throws.

   Change it to `uuid: ">=11.1.1 <13"`. This allows the uuid 11.x and 12.x lines (both ship a CommonJS entry) while blocking the ESM-only 13.x/14.x majors, and still satisfies the `>= 11.1.1` security floor. Add an inline comment: the `<13` bound is intentional because uuid 13+ is ESM-only and breaks CommonJS dependents like `gaxios@6` (from `@google-cloud/storage`); do NOT widen it back to `>=`. Do not lower the floor; do not touch the `js-yaml` override.

2. **Pin Node to 24.**
   - Add `.nvmrc` at the repo root containing `24`.
   - Add `"engines": { "node": ">=24" }` to the root `package.json`.
   - Add a `"packageManager"` field to the root `package.json` pinning the pnpm version already in use (match the version in `pnpm-lock.yaml` / the local pnpm, currently pnpm 10.34.5 — confirm and use the exact version).
   - Extend `scripts/preinstall.js` (already ESM, already enforces pnpm) to also read `process.versions.node`: if the major is < 24, print a clear, actionable message (state the required version and suggest `nvm use` / `fnm use`) and `process.exit(1)`. Keep it cross-platform (it deliberately replaced a shell version that broke on Windows). Only hard-fail on Node major < 24 and the existing non-pnpm check.

3. **Actionable web timeout message.** In `artifacts/it-task-manager/wait-for-api.mjs`, the timeout path prints only `Timed out waiting for API server.`. Update it to say the API server probably failed to start and to scroll up in the `[api]` output for the real error. Keep polling behavior and exit code unchanged.

4. **Faster api-server inner loop (esbuild watch + restart, no new deps).** Today `artifacts/api-server`'s `dev` script is `cross-env NODE_ENV=development pnpm run build && pnpm run start` — a one-shot build then cold `node` start, no rebuild on change. Replace it with a watch loop using esbuild's own `context()`/`watch()` API and Node's built-in `child_process` (do NOT add any dependency):
   - First, extract the esbuild options object currently inline in `artifacts/api-server/build.mjs` (entryPoints, `external` list, `banner`, loaders, plugins, sourcemap, format, outdir, etc.) into a single shared module (e.g. `artifacts/api-server/esbuild.config.mjs`) that exports it. Update `build.mjs` to import and use it so its output is unchanged. The prod build and the watch path MUST share this one config — the `external` list must never be duplicated.
   - Add a watch entry (e.g. `artifacts/api-server/dev.mjs`) that imports the shared config, creates an esbuild context, calls `ctx.watch()`, and manages a child `node --enable-source-maps ./dist/index.mjs`. On each successful rebuild (e.g. an esbuild plugin `onEnd` that only restarts when `result.errors.length === 0`), kill and respawn the child; on rebuild errors, log them and leave the last-good process running. Pass `NODE_ENV=development`, inherit `PORT` and stdio. Handle SIGINT/SIGTERM so Ctrl-C tears down both the watcher and the child with no orphan process.
   - Change the `dev` script to `cross-env NODE_ENV=development node ./dev.mjs`. Leave `build` (`node ./build.mjs`) and `start` (`node --enable-source-maps ./dist/index.mjs`) unchanged — the Docker/prod path must be unaffected.

5. **Document native setup.** Add or update a concise "Local development (native)" section in the repo root `README.md` (create it if absent) listing, in order: required Node 24 (via `.nvmrc`), `pnpm install`, `docker compose -f docker-compose.local.yml up db -d`, `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/opsly`, `pnpm run setup`, then `pnpm run dev`. Base the steps on the actual root `package.json` scripts (`setup`, `dev`) — do not invent commands.

## Acceptance Criteria

- With Node 24, `pnpm install` then `pnpm run dev` starts the api-server without `ERR_REQUIRE_ESM`; it serves `GET /api/healthz` (200) and the web server proceeds past `wait-for-api.mjs`.
- `pnpm-lock.yaml` resolves `uuid` to a `>=11.1.1 <13` version (11.x or 12.x), not `14.0.1`; `gaxios@6.7.1` depends on that CJS-capable uuid.
- `pnpm-workspace.yaml` shows `uuid: ">=11.1.1 <13"` with the explanatory comment; the security floor is preserved.
- Running under Node < 24 makes `pnpm install` fail fast via `scripts/preinstall.js` naming the required version; Node 24 passes.
- `.nvmrc` (`24`), root `engines.node` (`>=24`), and `packageManager` are present and consistent.
- `wait-for-api.mjs` timeout output points at the `[api]` logs.
- `artifacts/api-server` esbuild config lives in one shared module imported by both `build.mjs` and the watch entry; `pnpm run build` output is unchanged.
- `pnpm --filter @workspace/api-server run dev` starts the server, and editing a `.ts` under `artifacts/api-server/src` auto-rebuilds and restarts it; Ctrl-C exits cleanly with no orphan node process.
- README documents the native setup sequence.
- The change runs `pnpm install` so the regenerated `pnpm-lock.yaml` is committed.

## Relevant Files / Paths

- `pnpm-workspace.yaml` — the `uuid` override line.
- `pnpm-lock.yaml` — regenerated by `pnpm install`; commit it.
- `package.json` (root) — `engines`, `packageManager`.
- `.nvmrc` (root) — new, contents `24`.
- `scripts/preinstall.js` — add the Node-major guard.
- `artifacts/it-task-manager/wait-for-api.mjs` — timeout message only.
- `README.md` (root) — native setup section.
- `artifacts/api-server/build.mjs` — refactor to import shared config; output unchanged.
- `artifacts/api-server/esbuild.config.mjs` — new shared config (name is a suggestion).
- `artifacts/api-server/dev.mjs` — new watch entry (name is a suggestion).
- `artifacts/api-server/package.json` — update `dev` script only; add no dependencies.

## Standards to Follow

- **American English** everywhere, including new comments and README prose.
- **api-server esbuild quirk** (`.agents/memory/api-server-build-quirks.md`): the server is bundled by esbuild from its own `node_modules` with `@google-cloud/*` externalized. Do NOT "fix" the crash by bundling `@google-cloud/*` or editing the `external` list — the fix is bounding uuid.
- Do NOT disable or weaken `minimumReleaseAge` in `pnpm-workspace.yaml`, and do not touch `minimumReleaseAgeExclude`.
- Keep `scripts/preinstall.js` cross-platform and ESM.

## Out of Scope

- Do NOT add any npm dependency (watch loop uses esbuild + `child_process` only).
- Do NOT change the *behavior* of `build.mjs` — extracting shared config is required, but output, `external` list, and banner stay identical.
- Do NOT add CI or a smoke test here (that is Plan 02).
- Do NOT remove or rename any Replit code (Vite plugins, storage provider, auth mode, `@replit/*` deps) — Plans 03–05.
- Do NOT modify any Dockerfile / `docker-compose*.yml`, or `.replit`.
- Do NOT touch the frontend Vite dev server / HMR.
- Do NOT reformat unrelated parts of the touched files.
