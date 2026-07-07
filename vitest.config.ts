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
      exclude: ["src/**/*.spec.ts", "src/test/**", "src/ui-test/**"],
    },
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/vscode.mock.ts"),
    },
  },
});
