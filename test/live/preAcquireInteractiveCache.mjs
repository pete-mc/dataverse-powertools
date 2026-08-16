// Pre-acquire an interactive (OAuth) MSAL token cache for the interactive test user and write it
// to DVPT_TEST_MSAL_CACHE_FILE, using the SAME public-client app id + authority the extension uses.
// The extension (with that env var set) then reads this cache and connects SILENTLY — no browser
// to drive during the ExTester wizard. Run before `extest`.
//
//   DVPT_TEST_MSAL_CACHE_FILE=... node test/live/preAcquireInteractiveCache.mjs
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import * as cp from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const { PublicClientApplication } = require("@azure/msal-node");
const CDP = require("chrome-remote-interface");

const CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d"; // == DEFAULT_INTERACTIVE_CLIENT_ID
const AUTHORITY = "https://login.microsoftonline.com/organizations";
// Browser resolution mirrors src/webresources/debug/browserResolver.ts. It is duplicated rather
// than imported because this is a standalone .mjs run by scripts/runE2E.mjs, and test/ is outside
// the tsconfig scope so there is no compiled copy to import. DVPT_TEST_BROWSER_PATH wins: a
// headless Linux box often has no system browser, only one fetched by another tool at a
// version-stamped path that cannot be discovered by probing.
const BROWSER_CANDIDATES = {
  win32: [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};
function resolveBrowserPath() {
  if (process.env.DVPT_TEST_BROWSER_PATH) return process.env.DVPT_TEST_BROWSER_PATH;
  const found = (BROWSER_CANDIDATES[process.platform] || BROWSER_CANDIDATES.linux).find((c) => fs.existsSync(c));
  if (!found) throw new Error("No Edge/Chrome/Chromium found. Set DVPT_TEST_BROWSER_PATH to a Chromium executable.");
  return found;
}
// Ubuntu 23.10+ blocks Chromium's sandbox via its unprivileged-userns AppArmor restriction; without
// these the browser dies with "No usable sandbox!" before its CDP port ever listens.
const BROWSER_EXTRA_ARGS = process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function env() {
  const t = fs.readFileSync(path.join(REPO_ROOT, "sandbox", ".env"), "utf8");
  const e = {};
  for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) e[m[1]] = m[2]; }
  return e;
}
function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function driveMsalLogin(authUrl, USER, PASS) {
  const profile = path.join(os.tmpdir(), "dvpt-preacquire-login");
  fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true });
  const port = await freePort();
  const child = cp.spawn(resolveBrowserPath(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...BROWSER_EXTRA_ARGS, "--new-window", authUrl], { stdio: "ignore" });
  try {
    let client; for (let i = 0; i < 40 && !client; i++) { try { client = await CDP({ port }); } catch { await sleep(400); } }
    const { Runtime } = client; await Runtime.enable();
    const ev = async (e) => (await Runtime.evaluate({ expression: e, awaitPromise: true, returnByValue: true })).result.value;
    const setV = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.focus();const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    const clickBtn = () => ev(`(()=>{const b=document.querySelector('#idSIButton9');if(b){b.click();return true;}return false;})()`);
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const s = JSON.parse(await ev(`JSON.stringify((()=>{const q=s=>document.querySelector(s);const vis=e=>!!(e&&e.offsetParent!==null&&!e.disabled);const t=document.body?document.body.innerText:'';return{host:location.host,email:vis(q('input[name=loginfmt]')),pass:vis(q('input[name=passwd]')),consent:/permissions requested|consent|accepting these permissions/i.test(t),kmsi:/stay signed in\\?/i.test(t)||!!q('#KmsiCheckboxField')};})())`));
      if (s.host === "localhost" || s.host.startsWith("localhost:")) { await sleep(1500); break; }
      if (s.pass) { await setV("input[name=passwd]", PASS); await clickBtn(); await sleep(2500); }
      else if (s.email) { await setV("input[name=loginfmt]", USER); await clickBtn(); await sleep(2500); }
      else if (s.consent || s.kmsi) { await clickBtn(); await sleep(2000); }
      else await sleep(1500);
    }
    await client.close();
  } finally { await sleep(500); try { child.kill(); } catch {} }
}

const e = env();
const ORG = e.DVPT_TEST_URL.replace(/\/+$/, "");
const USER = e.DVPT_TEST_USERNAME.trim(), PASS = e.DVPT_TEST_PASSWORD;
const cacheFile = process.env.DVPT_TEST_MSAL_CACHE_FILE;
if (!cacheFile) { console.error("DVPT_TEST_MSAL_CACHE_FILE is required"); process.exit(1); }
fs.rmSync(cacheFile, { force: true });

const cachePlugin = {
  beforeCacheAccess: async (ctx) => { try { const d = fs.readFileSync(cacheFile, "utf8"); if (d) ctx.tokenCache.deserialize(d); } catch {} },
  afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) fs.writeFileSync(cacheFile, ctx.tokenCache.serialize()); },
};
const pca = new PublicClientApplication({ auth: { clientId: CLIENT_ID, authority: AUTHORITY }, cache: { cachePlugin } });
const res = await pca.acquireTokenInteractive({
  scopes: [`${ORG}/.default`],
  openBrowser: async (url) => driveMsalLogin(url, USER, PASS),
  successTemplate: "<html><body>Signed in. You can close this window.</body></html>",
});
console.log("pre-acquired interactive token for", res?.account?.username, "| cache file bytes:", fs.existsSync(cacheFile) ? fs.statSync(cacheFile).size : 0);
process.exit(res?.accessToken ? 0 : 1);
