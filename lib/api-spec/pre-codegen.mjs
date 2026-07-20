/**
 * pre-codegen.mjs
 *
 * Orval appends exports to existing index.ts files on each run.
 * This script resets each file to its "owned" baseline before orval runs,
 * so the final output is always idempotent.
 *
 * Stale-cache protection: the `typecheck:libs` step that follows orval in the
 * codegen script calls `tsc --build --force`, which bypasses any `.tsbuildinfo`
 * cache and always performs a full emit — even if `dist/` was deleted before
 * codegen ran. No additional tsbuildinfo cleanup is needed here.
 *
 * Run via:  node ./pre-codegen.mjs   (from lib/api-spec/)
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

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
