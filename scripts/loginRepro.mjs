// Fast, isolated repro of the e2e browser sign-in (steps 7/8 of the comprehensive e2e) so the
// autologin fix can be iterated in ~2 min instead of a 10-min full run. Launches Edge at the org
// and drives the AAD sign-in via the SAME compiled browserLib the e2e uses. Reads creds from
// sandbox/.env. Prints PASS/FAIL. Not shipped — a dev harness.
//
//   node scripts/loginRepro.mjs
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = require(path.join(root, "out", "ui-test", "e2e", "browserLib.js"));
const { resolveBrowser } = require(path.join(root, "out", "webresources", "debug", "browserResolver.js"));
const CDP = require("chrome-remote-interface");

async function dumpState(port) {
  try {
    const targets = await CDP.List({ port });
    const page = targets.filter((t) => t.type === "page").find((t) => t.url.startsWith("http"));
    const client = await CDP({ port, target: page });
    await client.Runtime.enable();
    const expr = `JSON.stringify((()=>{const ins=[...document.querySelectorAll('input')].map(i=>({name:i.name,type:i.type,id:i.id,vis:i.offsetParent!==null}));const btns=[...document.querySelectorAll('button,input[type=submit]')].map(b=>({t:(b.innerText||b.value||'').slice(0,30),id:b.id,vis:b.offsetParent!==null}));return{url:location.href.slice(0,120),title:document.title,heading:(document.querySelector('[role=heading],h1,h2')||{}).innerText||'',body:(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,400),inputs:ins,buttons:btns};})())`;
    const v = (await client.Runtime.evaluate({ expression: expr, returnByValue: true })).result.value;
    console.log("[login-repro] STUCK PAGE STATE:\n" + JSON.stringify(JSON.parse(v), null, 2));
    await client.close();
  } catch (e) {
    console.log("[login-repro] dump failed:", e?.message ?? e);
  }
}

const raw = {};
for (const line of fs.readFileSync(path.join(root, "sandbox", ".env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) raw[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const url = raw.DVPT_TEST_URL;
const username = raw.DVPT_TEST_USERNAME;
const password = raw.DVPT_TEST_PASSWORD;
const orgHost = new URL(url).host;
const log = (m) => console.log(`  ${m}`);

const resolved = resolveBrowser("auto", undefined, { platform: process.platform, env: process.env, exists: fs.existsSync });
const profileDir = path.join(os.tmpdir(), "dvpt-login-repro", `p${process.pid}`);
fs.rmSync(profileDir, { recursive: true, force: true });

console.log(`[login-repro] launching ${resolved.executablePath} at ${url}`);
const browser = await lib.launchBrowser(resolved.executablePath, profileDir, url);
try {
  const started = Date.now();
  const ok = await lib.autoLoginWithRetry(browser.port, url, { username, password, orgHost, log, timeoutMs: 45000 });
  console.log(`[login-repro] ${ok ? "PASS" : "FAIL"} — reached the org: ${ok} (${Math.round((Date.now() - started) / 1000)}s)`);
  if (!ok) {
    await dumpState(browser.port);
  }
  process.exitCode = ok ? 0 : 1;
} finally {
  browser.kill();
}
