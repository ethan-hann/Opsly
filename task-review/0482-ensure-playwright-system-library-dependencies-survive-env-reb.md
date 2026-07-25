# #482 — Ensure Playwright system library dependencies survive environment rebuilds

**State:** PROPOSED
**Depends on:** #477

---

# Ensure Playwright system library dependencies survive environment rebuilds

## What & Why

The Playwright e2e tests require several NixOS system libraries (glib, nspr, nss, atk, X11, libgbm, etc.) that were installed via installSystemDependencies during task #477. These are not yet recorded in any project config, so a fresh environment rebuild would lose them and make `pnpm test:e2e` fail immediately with "error while loading shared libraries".

## Done looks like

- The required system packages are declared in replit.nix or equivalent NixOS config so they are present in every environment without a manual install step
- Running `pnpm --filter @workspace/it-task-manager test:e2e` passes on a freshly provisioned environment

## Relevant files

- `artifacts/it-task-manager/playwright.config.ts`
- `artifacts/it-task-manager/e2e/touch-drag-tree.spec.ts`
- Project-level replit.nix or .replit (whichever governs system packages)
