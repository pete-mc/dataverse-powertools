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
  // Coverage of the EXTENSION HOST, reported separately from unit coverage (#143). Until this
  // existed only Vitest's numbers were reported, which measure the opposite half of the codebase:
  // unit coverage is high on extracted pure modules and ~0 on everything `vscode`-tangled, and the
  // integration suite is the only thing that executes the tangled half at all. Reporting one number
  // for "coverage" while the other half went unmeasured made the suite look thinner than it is and
  // gave no signal at all when an integration test stopped exercising a path.
  //
  // The host loads `dist/extension.js` (the webpack bundle), so `npm run compile` must have run —
  // `test:integration:coverage` does both. `mode: 'none'` + `nosources-source-map` in
  // webpack.config.js is what lets V8's bundle coverage map back to src/**.
  // Raw coverage only. The HTML reporter cannot run here: the bundle's V8 coverage includes
  // webpack's `external commonjs "…"` pseudo-modules, whose names contain quotes and spaces, and
  // writing a file per module fails on Windows before any other reporter gets to run. (test-cli
  // 0.0.15 passes `include`/`exclude` to c8 but they don't take effect against these, so filtering
  // has to happen after the fact.)
  //
  // scripts/integrationCoverage.mjs reads coverage-final.json and reports the part that matters —
  // src/**, excluding tests — which is the number #143 wanted: the integration suite exercises the
  // `vscode`-tangled half of the codebase that unit coverage necessarily reads as 0.
  coverage: {
    includeAll: false,
    reporter: ["json"],
  },
});
