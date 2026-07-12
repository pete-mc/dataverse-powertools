// E2E launcher: seed the interactive MSAL cache (best-effort), then run ExTester.
//
// Setting DVPT_TEST_MSAL_CACHE_FILE for the ExTester process makes the interactive-auth suites run
// (they self-skip without it) AND makes the extension's cache plugin read the seeded sign-in, so the
// interactive connect is silent inside VS Code. If seeding fails (no creds / ROPC blocked), the
// interactive suites simply skip and the service-principal suites still run — the launcher never
// fails the whole run over a missing interactive cache.

import { spawnSync } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// One cache path shared by the seeder, the extension, and the suites' hasCache check.
const cacheFile = process.env.DVPT_TEST_MSAL_CACHE_FILE || path.join(root, "sandbox", ".msal-test-cache.json");
// The extension mirrors its output channel here (context.ts DVPT_TEST_LOG_FILE
// seam); after the run a sanity audit scans the WHOLE log for failure signatures
// the suites' coded expectOutput gates didn't predict.
const logFile = path.join(root, "sandbox", "e2e-extension-output.log");
fs.rmSync(logFile, { force: true });
const env = { ...process.env, DVPT_TEST_MSAL_CACHE_FILE: cacheFile, DVPT_TEST_LOG_FILE: logFile };

// Glob(s) to run come from argv; default to the whole e2e suite.
const globs = process.argv.slice(2);
if (globs.length === 0) {
  globs.push("out/ui-test/e2e/**/*.e2e.js");
}

console.log("[e2e] seeding interactive MSAL cache (best-effort)…");
const seed = spawnSync("node", [path.join("scripts", "preAcquireInteractiveCache.mjs")], { cwd: root, env, stdio: "inherit" });
if (seed.status !== 0) {
  console.warn("[e2e] interactive cache not seeded — interactive-auth suites will self-skip (service-principal suites still run).");
}

const extestArgs = ["extest", "setup-and-run", ...globs, "--code_settings", "test/ui-settings.json", "--extensions_dir", "sandbox/ext-dir-clean", "--mocha_config", ".mocharc-e2e.json"];
console.log(`[e2e] launching: npx ${extestArgs.join(" ")}`);
const run = spawnSync("npx", extestArgs, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });

// Post-run sanity audit: even a fully green run can hide a failure the coded
// gates didn't know about (a 400 form save once survived a "23 passing" run).
// Findings fail the run — each is either a real bug, or a benign line to add
// to the allowlist in src/ui-test/e2e/logAudit.ts.
let auditFailed = false;
try {
  const { auditLog, formatAuditReport } = createRequire(import.meta.url)(path.join(root, "out", "ui-test", "e2e", "logAudit.js"));
  const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  if (!logText) {
    console.warn("[e2e] log audit: no mirrored extension log found — audit skipped.");
  } else {
    const findings = auditLog(logText);
    console.log(formatAuditReport(findings, logText.split(/\r?\n/).length));
    auditFailed = findings.length > 0;
  }
} catch (err) {
  console.warn(`[e2e] log audit could not run: ${err}`);
}

process.exit(run.status !== 0 ? (run.status ?? 1) : auditFailed ? 1 : 0);
