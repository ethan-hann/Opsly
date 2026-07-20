/**
 * post-codegen.mjs
 *
 * Runs after orval to write the final correct content of each index.ts.
 *
 * Problem: orval always APPENDS to the workspace index.ts on every run.
 * Without a reset, each codegen run would accumulate duplicate export lines.
 * The legacy fix (pre-codegen.mjs resetting index.ts to a partial/empty state
 * before orval) introduced a race window: if a concurrent `tsc --build --force`
 * ran while index.ts was in the partial state it would compile an incomplete
 * `dist/index.d.ts`, causing TS2305 "has no exported member" across the project.
 *
 * The new approach: never put index.ts into an invalid state.
 *   1. pre-codegen.mjs no longer touches index.ts files.
 *   2. orval appends to the already-correct index.ts (creating duplicates).
 *      TypeScript allows duplicate `export *` statements; they compile fine.
 *   3. THIS script rewrites each index.ts to the canonical final content,
 *      removing duplicates and leaving the file identical to its committed state.
 *
 * The concurrent typecheck workflow therefore always sees index.ts in a valid
 * state: either the committed baseline (before codegen starts) or with harmless
 * duplicates (while orval is running). Both states compile correctly.
 *
 * Run via:  node ./post-codegen.mjs   (from lib/api-spec/)
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

// api-zod: index.ts is fully managed by orval (orval rewrites the generated
// folder and appends these two export lines on every run).
writeFileSync(
  resolve(root, "lib/api-zod/src/index.ts"),
  "export * from './generated/api';\nexport * from './generated/types';\n",
);

// api-client-react: index.ts has a hand-written preamble (custom-fetch) plus
// the generated hook/schema exports that orval appends.
writeFileSync(
  resolve(root, "lib/api-client-react/src/index.ts"),
  [
    'export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";',
    'export type { AuthTokenGetter } from "./custom-fetch";',
    "export * from './generated/api';",
    "export * from './generated/api.schemas';",
    "",
  ].join("\n"),
);

console.log("post-codegen: index.ts files written to canonical content.");
