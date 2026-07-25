# #509 — Catch a broken production Docker build before it reaches self-hosters

**State:** PROPOSED
**Depends on:** #497

---

# Catch a broken production Docker build before it reaches self-hosters

## What & Why

The Dockerfile and compose stack were validated manually in task #497. Without an automated CI check, a future change to a workspace package.json, pnpm-workspace.yaml, or the Dockerfile itself could silently break the production build. Self-hosters would discover the breakage when they try to install.

## Done looks like

- A GitHub Actions workflow (or equivalent CI) runs `docker build -f Dockerfile .` on every push to main
- The workflow also starts the stack and curls `/api/healthz` to confirm the health check passes
- Failures block merge

## Relevant files

- `Dockerfile`
- `docker-compose.yml`
- `.env.production.example`
- `SELF_HOSTING.md`
