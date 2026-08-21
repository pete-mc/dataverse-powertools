// Local fixes to vscode-extension-tester, applied on postinstall.
//
// Both are upstream bugs (redhat-developer/vscode-extension-tester) that make the e2e/UI harness
// unusable for us; both are worth a PR there, and this file should shrink to nothing when they land.
// Each patch is idempotent, and LOUD when the code it expects has changed — a silently-skipped
// patch would quietly restore the breakage.
//
//   #270  A GitHub-raw outage fails every run before VS Code launches.
//   #268  `openResources()` silently does nothing on Linux, so suites drive a folder-less window.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codeUtil = path.join(root, "node_modules", "vscode-extension-tester", "out", "util", "codeUtil.js");

/**
 * #270 — ChromeDriver version lookup must fall back to the local cache when GitHub raw is down.
 *
 * ExTester resolves which ChromeDriver to download by reading VS Code's cgmanifest.json from GitHub
 * raw. It HAS an offline fallback (`getChromiumVersionOffline()`), but the network call sits OUTSIDE
 * the try/catch that fallback lives in, so a 503 throws straight past it. Three consecutive runs
 * were lost to exactly this during a GitHub outage — with VS Code and ChromeDriver already cached,
 * and with `--offline`, which is accepted but does not skip the fetch.
 */
const offlineFallback = {
  issue: "#270",
  what: "ChromeDriver version lookup falls back to the cache when GitHub raw is down",
  before: `        await download_1.Download.getFile(url, path.join(this.downloadFolder, fileName));
        try {
            const manifest = require(path.join(this.downloadFolder, fileName));`,
  after: `        try {
            // Dataverse PowerTools #270: fetch INSIDE the try, so a GitHub-raw outage falls through
            // to getChromiumVersionOffline() below instead of failing the run before it starts.
            await download_1.Download.getFile(url, path.join(this.downloadFolder, fileName));
            const manifest = require(path.join(this.downloadFolder, fileName));`,
};

/**
 * #268 — `openResources()` must actually open the folder on Linux.
 *
 * `CodeUtil.open()` shells out through VS Code's Node CLI entry point:
 *
 *   ELECTRON_RUN_AS_NODE=1 <code> <resources/app/out/cli.js> -r <folder> --user-data-dir=<dir>
 *
 * On Linux that command exits 0, prints nothing, spawns no lasting process — and the running
 * instance never opens the folder. Proven by bisect: with the SAME user-data-dir and the same
 * chromedriver launch flags, the CLI route leaves the window titled "Visual Studio Code" while
 * invoking the Code binary directly with the same arguments reuses the window correctly
 * ("Welcome - <folder> - Visual Studio Code").
 *
 * The failure is silent in every layer: `execSync` sees exit 0, ExTester's `waitForWorkbench()`
 * succeeds because the workbench IS up (just folder-less), and the extension then no-ops in every
 * path guarded on `vscode.workspace.workspaceFolders` — which surfaced as a missing input box three
 * steps later, in a different function, with "No Template Found" as the only clue.
 *
 * Linux only, deliberately: the CLI route works on Windows, where the suite is green, and a change
 * there would be an untested regression risk for no gain.
 */
const linuxOpenResources = {
  issue: "#268",
  what: "openResources() reuses the driven window on Linux",
  before: `    open(...paths) {
        const segments = paths.map((f) => \`"\${f}"\`).join(' ');
        const command = \`\${this.getCliInitCommand()} -r \${segments} --user-data-dir="\${path.join(this.downloadFolder, 'settings')}"\`;
        childProcess.execSync(command);
    }`,
  after: `    open(...paths) {
        const segments = paths.map((f) => \`"\${f}"\`).join(' ');
        // Dataverse PowerTools #268: on Linux the ELECTRON_RUN_AS_NODE cli.js route exits 0 and
        // does nothing, leaving the driven window folder-less. Invoking the binary directly with
        // the same arguments reuses the window as intended.
        const command = process.platform === 'linux'
            ? \`"\${this.executablePath}" --no-sandbox -r \${segments} --user-data-dir="\${path.join(this.downloadFolder, 'settings')}"\`
            : \`\${this.getCliInitCommand()} -r \${segments} --user-data-dir="\${path.join(this.downloadFolder, 'settings')}"\`;
        childProcess.execSync(command);
    }`,
};

const MARKER = "Dataverse PowerTools #";

if (!fs.existsSync(codeUtil)) {
  // Not an error: a production install has no devDependencies.
  console.log("[patch-extester] vscode-extension-tester not installed — nothing to patch.");
  process.exit(0);
}

let source = fs.readFileSync(codeUtil, "utf8");
let applied = 0;

for (const patch of [offlineFallback, linuxOpenResources]) {
  if (source.includes(`${MARKER}${patch.issue.slice(1)}`)) {
    console.log(`[patch-extester] ${patch.issue} already applied (${patch.what}).`);
    continue;
  }
  if (!source.includes(patch.before)) {
    console.warn(
      `[patch-extester] Could NOT apply ${patch.issue} (${patch.what}): vscode-extension-tester no longer ` +
        `matches the expected shape. Check whether upstream fixed it ` +
        `(https://github.com/redhat-developer/vscode-extension-tester) and drop this patch if so — ` +
        `otherwise the breakage it works around is back.`,
    );
    continue;
  }
  source = source.replace(patch.before, patch.after);
  applied++;
  console.log(`[patch-extester] Applied ${patch.issue}: ${patch.what}.`);
}

if (applied > 0) {
  fs.writeFileSync(codeUtil, source, "utf8");
}
