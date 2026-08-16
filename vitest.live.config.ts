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
    // Live spec FILES must not run concurrently. `pac` keeps ONE active auth profile
    // per machine (~/.local/share/Microsoft/PowerAppsCli on Linux, %APPDATA% on
    // Windows) and `pac auth create` makes the profile it creates the active one.
    // Three specs — pacOrgSelect, pluginLifecycle, solutionPacRoundtrip — each create
    // a profile and then rely on it still being active for `org who` / `modelbuilder` /
    // `solution export`. Run in parallel they steal the active profile from each other:
    // the observed failure was pacOrgSelect's `org who` reporting "No active environment
    // set for the current auth profile" — which impersonates the very earlybound-OAuth
    // regression that spec exists to guard, so the red looks like a product bug and is
    // not one. Serialising files also removes the same class of collision between specs
    // that create fixed-name Dataverse rows (see #258 for the cross-RUN half of that).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/vscode.mock.ts"),
    },
  },
});
