// Supervised UI-test launcher.
//
//   npm run test:supervised          FRESH: clears auth + pac, YOU sign in (OAuth + pac
//                                     device-code) when prompted. Both sign-ins are captured.
//   npm run test:supervised:reuse    REUSE: keeps the captured OAuth + pac profile from a
//                                     prior fresh run and runs UNATTENDED — for fix iterations.
//
// The extension's MSAL token cache is pointed at a PERSISTENT file (not deleted between reuse
// runs), so a one-time interactive sign-in is reused silently afterwards (tokenAcquisition.ts's
// DVPT_TEST_MSAL_CACHE_FILE seam is read/write). The pac profile lives in pac's own machine store
// and is reused by the 0.14.1 `pac auth select` path — so it survives across runs too. Reuse mode
// works until either token needs an interactive renewal, at which point run fresh again.
//
// Mocha bails on the first failure (.mocharc-supervised.json) so a run stops exactly where a flow
// breaks. Screenshots land in sandbox/supervised-shots/.

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reuse = process.argv.includes("--reuse") || process.env.DVPT_SUPERVISED_REUSE === "1";
const globs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (globs.length === 0) {
  globs.push("out/ui-test/supervised/**/*.e2e.js");
}

// Persistent across reuse runs; wiped only on a fresh run so the human re-signs in.
const msalCache = path.join(root, "sandbox", ".supervised-msal-cache.json");
const logFile = path.join(root, "sandbox", "supervised-extension-output.log");
fs.rmSync(logFile, { force: true });

// Minimal sandbox/.env read for DVPT_SUPERVISED_ENV (the environment to auto-pick after sign-in).
function envValue(key) {
  try {
    for (const line of fs.readFileSync(path.join(root, "sandbox", ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && m[1] === key && !line.trimStart().startsWith("#")) {
        return m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env */
  }
  return undefined;
}
const supervisedEnv = process.env.DVPT_SUPERVISED_ENV || envValue("DVPT_SUPERVISED_ENV") || "";
const supervisedSolution = process.env.DVPT_SUPERVISED_SOLUTION || envValue("DVPT_SUPERVISED_SOLUTION") || "";

if (reuse) {
  if (!fs.existsSync(msalCache)) {
    console.error("[supervised] reuse mode but no captured sign-in found — run `npm run test:supervised` (fresh) once first.");
    process.exit(2);
  }
  if (!supervisedEnv || !supervisedSolution) {
    console.error("[supervised] reuse mode needs DVPT_SUPERVISED_ENV (env name/url) and DVPT_SUPERVISED_SOLUTION (solution display name) in sandbox/.env so it can drive the wizard without you.");
    process.exit(2);
  }
  console.log(`[supervised] REUSE mode — unattended. env="${supervisedEnv}" solution="${supervisedSolution}".`);
} else {
  fs.rmSync(msalCache, { force: true });
  console.log("[supervised] FRESH mode — you'll sign in (OAuth in the browser, then the pac device code) when I prompt you.");
  console.log(supervisedEnv ? `[supervised] will auto-pick environment "${supervisedEnv}" after your sign-in.` : "[supervised] set DVPT_SUPERVISED_ENV in sandbox/.env to auto-pick your environment (else you'll pick it in the quick pick).");
}

const env = {
  ...process.env,
  DVPT_TEST_MSAL_CACHE_FILE: msalCache,
  DVPT_TEST_LOG_FILE: logFile,
  DVPT_SUPERVISED_REUSE: reuse ? "1" : "",
  DVPT_SUPERVISED_ENV: supervisedEnv,
  DVPT_SUPERVISED_SOLUTION: supervisedSolution,
};

const extestArgs = ["extest", "setup-and-run", ...globs, "--code_settings", "test/ui-settings.json", "--extensions_dir", "sandbox/ext-dir-clean", "--mocha_config", ".mocharc-supervised.json"];
const run = spawnSync("npx", extestArgs, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(run.status ?? 1);
