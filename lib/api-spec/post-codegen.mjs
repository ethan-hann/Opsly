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
 * Additionally, orval (zod client, split mode) generates both:
 *   - generated/api.ts           — zod schemas named {OperationId}Params
 *   - generated/types/{op}Params.ts — TypeScript types with the same name
 *
 * When an operation has BOTH path params AND query params, both outputs share
 * the same export name, causing a TS2308 ambiguity when types/index.ts re-exports
 * the type alongside the zod schema from api.ts. This script also deduplicates
 * types/index.ts, removing any re-export whose PascalCase name already exists
 * as a const in api.ts (the zod schema is authoritative; the TS-only type is
 * unnecessary).
 *
 * Run via:  node ./post-codegen.mjs   (from lib/api-spec/)
 */

import { readFileSync, writeFileSync } from "fs";
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

// Deduplicate types/index.ts — remove any `export * from './<name>'` lines
// whose PascalCase identifier already exists as a const in api.ts, preventing
// TS2308 ambiguity errors when both path + query params exist for an operation.
const apiZodGenerated = resolve(root, "lib/api-zod/src/generated");
const typesIndexPath = resolve(apiZodGenerated, "types/index.ts");
const apiTsPath = resolve(apiZodGenerated, "api.ts");

const apiTs = readFileSync(apiTsPath, "utf8");
const apiExports = new Set(
  [...apiTs.matchAll(/^export const (\w+)/gm)].map((m) => m[1])
);

const typesIndex = readFileSync(typesIndexPath, "utf8");
const lines = typesIndex.split("\n");
const filtered = lines.filter((line) => {
  const m = line.match(/^export \* from '\.\/(\w+)';/);
  if (!m) return true;
  const typeName = m[1][0].toUpperCase() + m[1].slice(1);
  if (apiExports.has(typeName)) {
    console.log(`post-codegen: removed duplicate type export "${typeName}" from types/index.ts`);
    return false;
  }
  return true;
});

writeFileSync(typesIndexPath, filtered.join("\n"));
console.log("post-codegen: types/index.ts deduplication complete.");
