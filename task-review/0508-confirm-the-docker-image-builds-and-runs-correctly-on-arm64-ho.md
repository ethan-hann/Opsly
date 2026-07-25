# #508 — Confirm the Docker image builds and runs correctly on ARM64 hosts (AWS Graviton, Raspberry Pi)

**State:** PROPOSED
**Depends on:** #497

---

# Confirm the Docker image builds and runs correctly on ARM64 hosts

## What & Why

The `pnpm-workspace.yaml` overrides exclude all non-linux-x64 native binaries (esbuild, rollup, lightningcss, tailwindcss-oxide) to reduce install size in Replit's linux-x64 environment. Self-hosters on AWS Graviton2/3, Raspberry Pi 4/5, or Apple Silicon Macs running Docker on ARM64 will hit build failures because those binaries are missing from the lockfile.

## Done looks like

- A docker buildx multi-platform build (`linux/amd64,linux/arm64`) completes without errors
- The health check passes on an ARM64 host
- OR: the platform-specific override approach is reconsidered so that self-hosters can build from source on any architecture

## Approaches to consider

- Publish a multi-platform image to a registry (e.g. ghcr.io) so self-hosters on ARM64 can pull a pre-built image instead of building locally
- Or: split the Replit-specific pnpm overrides into a separate file that isn't included in the production build context

## Relevant files

- `pnpm-workspace.yaml` (overrides section)
- `Dockerfile`
- `SELF_HOSTING.md` (should document supported architectures)
