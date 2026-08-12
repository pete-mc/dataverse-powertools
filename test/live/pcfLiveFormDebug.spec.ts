import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import * as cp from "child_process";
import CDP = require("chrome-remote-interface");
import { loadLiveEnv, liveOrgUrl } from "../liveEnv";
import { isPcfBundleUrl, pcfBundleCdpPattern, pcfBundleContentType } from "../../src/pcf/debug/pcfBundleUrl";
import { resolveBrowser } from "../../src/webresources/debug/browserResolver";
import { buildBrowserArgs } from "../../src/webresources/debug/browserArgs";

// LIVE e2e for the PCF "Debug on live form (hot)" feature (#141 #5): prove the extension's CDP
// interception serves the LOCAL build for a DEPLOYED control's bundle URL. The Fetch interception
// fires at the Request stage — BEFORE the request reaches Dataverse — so this needs no login and no
// pre-deployed control: it navigates a real (headless) browser to the documented deployed-bundle
// URL (`<org>/WebResources/cc_<Namespace>.<Constructor>/bundle.js`, confirmed live earlier) and
// asserts the browser received our local marker-stamped bundle, not whatever the server would send.
// Self-skips without creds or a browser. Mirrors the manual proof used to land 0.14.33/0.14.34.

const env = loadLiveEnv();
let browserPath: string | undefined;
try {
  browserPath = env ? resolveBrowser("auto", undefined, { platform: process.platform, env: process.env, exists: fs.existsSync }).executablePath : undefined;
} catch {
  browserPath = undefined;
}

const NS = "DvptE2E";
const CTOR = "DebugProbe";

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => res(p));
    });
  });
}

const gate = env && browserPath ? describe : describe.skip;

it(env && browserPath ? "live env + a browser available for the PCF debug e2e" : "PCF live-form debug e2e skipped (needs creds + Edge/Chrome)", () => {
  expect(true).toBe(true);
});

gate("PCF live-form debug — interception serves the local bundle (live)", () => {
  const orgUrl = liveOrgUrl(env).replace(/\/$/, "");
  const bundleUrl = `${orgUrl}/WebResources/cc_${NS}.${CTOR}/bundle.js`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-pcf-debug-"));
  const localBundle = path.join(tmpDir, "bundle.js");
  const marker = `/*DVPT_LOCAL_PCF_DEBUG_MARKER*/`;
  let browserProc: cp.ChildProcess | undefined;

  afterAll(() => {
    try {
      browserProc?.kill();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("the matcher recognises the deployed control's bundle URL", () => {
    // Sanity: the URL the browser will request matches the extension's matcher (the cc_ prefix
    // pac push adds is tolerated). This is the same shape confirmed live in 0.14.34.
    expect(isPcfBundleUrl(bundleUrl, NS, CTOR)).toBe(true);
  });

  it("a browser navigating the deployed bundle URL receives the LOCAL build (interception)", async () => {
    fs.writeFileSync(localBundle, `${marker}\nwindow.__DVPT_PCF_DEBUG__ = true;\n`, "utf8");
    const userDataDir = path.join(tmpDir, "profile");
    fs.mkdirSync(userDataDir, { recursive: true });
    const port = await freePort();
    browserProc = cp.spawn(browserPath!, [...buildBrowserArgs({ port, userDataDir, url: "about:blank" }), "--headless=new"], { stdio: "ignore" });

    const client = await (async () => {
      const deadline = Date.now() + 20000;
      for (;;) {
        try {
          return await CDP({ port });
        } catch (e) {
          if (Date.now() > deadline) {
            throw e;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    })();

    let served = false;
    try {
      const { Fetch, Page, Network } = client;
      await Page.enable();
      await Network.enable();
      // The model-driven app's service worker serves control bundles from Cache Storage above the
      // network — bypass it so the request reaches the Fetch layer where we can fulfil it (#64).
      await Network.setBypassServiceWorker({ bypass: true });
      await Fetch.enable({ patterns: [{ urlPattern: pcfBundleCdpPattern(), requestStage: "Request" }] });
      Fetch.requestPaused(async (params) => {
        try {
          if (isPcfBundleUrl(params.request.url, NS, CTOR)) {
            served = true;
            const body = fs.readFileSync(localBundle).toString("base64");
            await Fetch.fulfillRequest({
              requestId: params.requestId,
              responseCode: 200,
              responseHeaders: [{ name: "Content-Type", value: pcfBundleContentType() }],
              body,
            });
          } else {
            await Fetch.continueRequest({ requestId: params.requestId });
          }
        } catch {
          try {
            await Fetch.continueRequest({ requestId: params.requestId });
          } catch {
            /* gone */
          }
        }
      });

      await Page.navigate({ url: bundleUrl });
      await new Promise((r) => setTimeout(r, 3000));
      const evalRes = await client.Runtime.evaluate({ expression: "document.body ? document.body.innerText : ''", returnByValue: true });
      const content = String(evalRes.result.value || "");
      expect(served, "interception matched the bundle request").toBe(true);
      expect(content.includes(marker), "the browser received the LOCAL marker-stamped bundle").toBe(true);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 60000);
});
