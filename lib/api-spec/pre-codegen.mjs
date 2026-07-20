/**
 * pre-codegen.mjs
 *
 * Runs before orval. Previously this script reset index.ts files to a partial
 * state so that orval's append behaviour would produce the correct final
 * content. That approach introduced a race window: if a concurrent
 * `tsc --build --force` ran while index.ts was in the partial state it would
 * compile an incomplete `dist/index.d.ts`, causing TS2305 errors project-wide.
 *
 * The reset responsibility has been moved to post-codegen.mjs, which runs
 * AFTER orval and writes the canonical final content atomically. index.ts
 * files are therefore never in an invalid state during codegen.
 *
 * This file is kept as a no-op placeholder so the codegen script pipeline
 * (`node ./pre-codegen.mjs && orval ... && node ./post-codegen.mjs`) remains
 * structurally consistent and any future pre-orval work has a clear home.
 *
 * Stale-cache protection: the `typecheck:libs` step that follows in the
 * codegen script calls `tsc --build --force`, which bypasses any
 * `.tsbuildinfo` cache and always performs a full emit — even if `dist/` was
 * deleted before codegen ran. No additional tsbuildinfo cleanup is needed.
 *
 * Run via:  node ./pre-codegen.mjs   (from lib/api-spec/)
 */

console.log("pre-codegen: nothing to do.");
