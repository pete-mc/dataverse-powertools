import { defineConfig } from "vitest/config";
import * as path from "path";

// Opt-in LIVE tests that talk to a real Dataverse environment. Run with
// `npm run test:live`. These are kept out of the normal `test:unit` run and self-skip
// when no credentials are present (see test/liveEnv.ts), so they never break CI.
export default defineConfig({
  test: {
    include: ["test/live/**/*.spec.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/vscode.mock.ts"),
    },
  },
});
