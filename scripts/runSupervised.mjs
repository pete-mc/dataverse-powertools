// Supervised UI-test launcher — run on demand with `npm run test:supervised`.
//
// Unlike scripts/runE2E.mjs, this does NOT seed an MSAL cache: the whole point is
// that YOU do the real OAuth sign-in (a new profile) while watching the run. It
// launches a real VS Code window you can see and interact with, and Mocha bails on
// the first failure (.mocharc-supervised.json) so the run stops exactly where a
// flow breaks. Screenshots land in sandbox/supervised-shots/.

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mirror the extension's output channel so you (and any later audit) can read what
// the extension actually did during the run.
const logFile = path.join(root, "sandbox", "supervised-extension-output.log");
fs.rmSync(logFile, { force: true });
const env = { ...process.env, DVPT_TEST_LOG_FILE: logFile };

// Default to the supervised suite; allow an explicit glob to run a single scenario.
const globs = process.argv.slice(2);
if (globs.length === 0) {
  globs.push("out/ui-test/supervised/**/*.e2e.js");
}

console.log("[supervised] NOTE: this run needs YOU — you'll do the OAuth + pac sign-in when prompted.");
console.log(`[supervised] launching: ${globs.join(", ")}`);
const extestArgs = ["extest", "setup-and-run", ...globs, "--code_settings", "test/ui-settings.json", "--extensions_dir", "sandbox/ext-dir-clean", "--mocha_config", ".mocharc-supervised.json"];
const run = spawnSync("npx", extestArgs, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(run.status ?? 1);
