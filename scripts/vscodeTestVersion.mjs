// Pinned VS Code version for the ExTester UI / e2e / supervised harnesses.
//
// By default ExTester downloads the "latest" stable VS Code. When a fresh VS Code
// release ships an archive layout the installed `vscode-extension-tester` doesn't yet
// understand, setup breaks BEFORE any test runs — e.g. 1.129.0 against
// vscode-extension-tester@8.23.0 failed with "Cannot find module …/resources/app/out/cli.js"
// (the extracted folder hash didn't match what ExTester probed for). Pinning a known-good
// version makes the harness deterministic and immune to that class of breakage.
//
// To bump: confirm a newer VS Code drives the panel webview with the installed
// vscode-extension-tester (run `npm run test:ui` / `test:e2e`), then update BOTH this
// constant AND the inline `--code_version` in package.json's `test:ui` script (JSON can't
// import this module). Override for a one-off run with DVPT_TEST_CODE_VERSION.
export const VSCODE_TEST_VERSION = "1.128.1";

/** The `--code_version <v>` args for an `extest setup-and-run` invocation. */
export function codeVersionArgs() {
  return ["--code_version", process.env.DVPT_TEST_CODE_VERSION || VSCODE_TEST_VERSION];
}
