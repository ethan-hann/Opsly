# #511 — Shrink the Docker image further by pruning dev-only packages from the pnpm store before copying it to the runner

**State:** PROPOSED
**Depends on:** #498

---

# Shrink the Docker image further by pruning dev-only packages from the pnpm store before copying it to the runner

## What & Why

Task #498 copies the full pnpm content-addressable store from the builder stage into the runner image. The store still contains blobs for dev-only packages (TypeScript, Vite, esbuild, vitest, etc.) that were installed in the deps/builder stages. Only the blobs reachable from production dependencies are actually needed by the runner.

Running `pnpm store prune` after `pnpm install --prod` in a separate intermediate stage would remove unreferenced blobs before the COPY, reducing the store layer size and therefore the final image size.

## Done looks like

- A new intermediate stage (e.g. `prod-deps`) installs only production deps and prunes the store
- The runner copies the pruned store instead of the full builder store
- `docker image ls` confirms a measurably smaller final image

## Relevant files

- `Dockerfile` (deps/builder/runner stages, store COPY)
