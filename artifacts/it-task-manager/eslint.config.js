import tseslint from "typescript-eslint";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    // Apply TypeScript parser to all TS/TSX source files.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      // typescript-eslint ships its own parser; use it directly so ESLint can
      // understand TypeScript syntax without any type-checking overhead.
      parser: tseslint.parser,
    },
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      // Flags any file that mixes React component exports with non-component
      // exports (e.g. a utility constant or hook exported alongside a component).
      // Mixed exports prevent Vite's fast refresh from working correctly and
      // can cause hot-reload crashes in development.  Catching the pattern at
      // lint time means the problem surfaces at save rather than at runtime.
      //
      // checkJS: false — only enforce on TypeScript files where the component
      // detection heuristic is reliable.
      "react-refresh/only-export-components": ["warn", { checkJS: false }],
    },
  },
];
