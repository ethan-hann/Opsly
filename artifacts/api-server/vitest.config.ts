import { defineConfig } from "vitest/config";
import fs from "node:fs";

// Serve .yaml files as raw text strings so that `import spec from "*.yaml"`
// returns the YAML string (ready for js-yaml.load) rather than crashing vitest's
// import-analysis step.
const yamlAsString = {
  name: "yaml-as-string",
  transform(_code: string, id: string) {
    if (id.endsWith(".yaml")) {
      const content = fs.readFileSync(id, "utf8");
      return `export default ${JSON.stringify(content)}`;
    }
  },
};

export default defineConfig({
  plugins: [yamlAsString],
  cacheDir: `/tmp/vitest-cache-api-server-${process.pid}`,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
