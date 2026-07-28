---
name: No per-platform pnpm binary overrides
description: Never re-add esbuild/rollup/lightningcss/tailwind-oxide/ngrok platform exclusions in pnpm-workspace.yaml — they break native installs on macOS/Windows/ARM.
---

# No per-platform pnpm binary overrides

`pnpm-workspace.yaml` `overrides` must **not** prune native prebuilt binaries down
to a single platform — e.g. `"esbuild>@esbuild/win32-x64": "-"`, and the same shape
for `rollup>@rollup/rollup-*`, `lightningcss>lightningcss-*`,
`@tailwindcss/oxide>@tailwindcss/oxide-*`, and `@expo/ngrok-bin>@expo/ngrok-bin-*`.

A block of ~75 such exclusions (pruning everything to linux-x64-gnu) previously
existed here and was **removed deliberately**.

**Why:** pnpm already installs only the current host's binary via each package's
`os`/`cpu`-filtered `optionalDependencies`. So these exclusions give **no**
Docker-image benefit — the linux container installs only linux-x64 either way —
but they **break** native `pnpm install` and `pnpm build` for anyone developing on
macOS, Windows, or ARM (verified: with them removed, both the frontend and
api-server builds run natively on Windows).

**How to apply:**
- Leave native binaries to pnpm's default per-host resolution.
- Only version pins and security overrides belong in `overrides` (e.g. `esbuild`,
  `uuid`, `js-yaml`, the drizzle-kit `@esbuild-kit/esm-loader` fix).
- If the goal is a smaller Docker image, prune dev dependencies in the Dockerfile
  (a production/prune install stage) — never platform binaries in the lockfile.
- The regenerated `pnpm-lock.yaml` intentionally lists all-platform binaries; that
  is correct and required for cross-platform installs. Do not "clean it up."
