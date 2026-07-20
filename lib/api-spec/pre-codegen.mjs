/**
 * pre-codegen.mjs
 *
 * Runs before orval to put the workspace in a known-good state:
 *
 * 1. Resets index.ts files — orval appends to existing files on each run,
 *    so we clear them first to keep output idempotent.
 *
 * 2. Deletes .tsbuildinfo caches — tsc composite builds record build validity
 *    in .tsbuildinfo. If dist/ is deleted while the cache remains, a subsequent
 *    `tsc --build` (without --force) considers the project up-to-date and
 *    emits nothing, leaving dist/ absent with no error. Removing the cache
 *    here ensures any tsc invocation after codegen always performs a full emit.
 *
 * Run via:  node ./pre-codegen.mjs   (from lib/api-spec/)
 */

import { writeFileSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

// ── 1. Reset index.ts files ──────────────────────────────────────────────────

// api-zod: orval owns index.ts fully — clear it so orval writes a fresh copy.
writeFileSync(resolve(root, "lib/api-zod/src/index.ts"), "");

// api-client-react: keep only the hand-written custom-fetch re-exports;
// orval will append the generated hook/schema exports after.
writeFileSync(
  resolve(root, "lib/api-client-react/src/index.ts"),
  [
    'export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";',
    'export type { AuthTokenGetter } from "./custom-fetch";',
    "",
  ].join("\n"),
);

console.log("pre-codegen: index.ts files reset.");

// ── 2. Invalidate tsbuildinfo caches ────────────────────────────────────────

const tsbuildinfos = [
  resolve(root, "lib/api-zod/tsconfig.tsbuildinfo"),
  resolve(root, "lib/api-client-react/tsconfig.tsbuildinfo"),
];

for (const f of tsbuildinfos) {
  rmSync(f, { force: true }); // force: true — no error if file doesn't exist
  console.log(`pre-codegen: removed ${f}`);
}

console.log("pre-codegen: tsbuildinfo caches cleared.");
