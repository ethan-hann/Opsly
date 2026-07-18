import { Router } from "express";
import { load } from "js-yaml";
// @ts-ignore — YAML files are bundled as text by esbuild
import specYaml from "../../../../lib/api-spec/openapi.yaml";

const router = Router();

// Parse once at startup
const specJson = load(specYaml) as object;

/** GET /api/openapi.json — machine-readable spec */
router.get("/openapi.json", (_req, res) => {
  res.json(specJson);
});

/** GET /api/openapi.yaml — raw YAML spec */
router.get("/openapi.yaml", (_req, res) => {
  res.setHeader("Content-Type", "application/yaml");
  res.send(specYaml);
});

/** GET /api/docs — interactive Scalar docs UI */
router.get("/docs", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>IT Task Manager — API Docs</title>
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/api/openapi.json"
      data-configuration='{"theme":"kepler","layout":"modern","defaultHttpClient":{"targetKey":"javascript","clientKey":"fetch"}}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});

export default router;
