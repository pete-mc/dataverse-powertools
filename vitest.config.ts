import { defineConfig } from "vitest/config";
import * as path from "path";

// Fast, editor-free unit tests for pure logic.
// The `vscode` module is not available outside the extension host, so it is
// aliased to a hand-written mock. Prefer extracting pure logic into modules
// that don't import `vscode` at all — those need no mock and test fastest.
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/test/**", "src/ui-test/**", "src/plugins_old/**"],
      reporter: ["text", "text-summary"],
      // A floor that guards against coverage *regressions* (run in CI via test:coverage).
      // Global unit coverage is low by design: most of src is tangled with the vscode API
      // and is covered by the integration + ExTester UI suites, not unit tests. Ratchet
      // these up as vscode-free logic is extracted and unit-tested (see #80).
      thresholds: {
        statements: 10,
        branches: 11,
        functions: 15,
        lines: 10,
      },
    },
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/vscode.mock.ts"),
    },
  },
});
