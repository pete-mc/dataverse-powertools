import { defineConfig } from "@vscode/test-cli";

// Integration tests: run inside a real VS Code extension host and exercise the
// extension through the `vscode` API (commands, context keys, activation).
// Test sources live in `src/test/suite/*.test.ts` and are compiled to `out/`
// by `npm run compile-tests` (wired into the `test:integration` script).
export default defineConfig({
  files: "out/test/suite/**/*.test.js",
  version: "stable",
  mocha: {
    ui: "tdd",
    timeout: 60000,
  },
});
