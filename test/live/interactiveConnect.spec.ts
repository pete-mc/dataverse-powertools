/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as cp from "child_process";
import * as vscode from "vscode"; // aliased to test/vscode.mock.ts
import CDP = require("chrome-remote-interface");
import { loadLiveEnv, loadInteractiveTestUser, LiveEnv } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { DataverseWebresource } from "../../src/general/dataverse/DataverseWebresource";
import { acquireInteractiveToken } from "../../src/general/dataverse/tokenAcquisition";
import DataversePowerToolsContext from "../../src/context";

// Verifies the extension's real INTERACTIVE (OAuth/MSAL loopback) auth path end-to-end against a
// live org: acquire a token as the interactive user by auto-driving the MSAL sign-in browser,
// then do a real Dataverse write (deploy a web resource) with that token. Proves interactive-user
// auth works cross-platform (complements the service-principal e2e).
//
//   DVPT_DEBUG_DEMO=1 npm run test:live -- test/live/interactiveConnect.spec.ts
const env = loadLiveEnv();
const user = loadInteractiveTestUser();
const enabled = !!env && !!user && process.env.DVPT_DEBUG_DEMO === "1";
const suite = enabled ? describe : describe.skip;

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (m: string): void => {
  // eslint-disable-next-line no-console
  console.log(`[interactive] ${m}`);
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const p = typeof a === "object" && a ? a.port : 0;
      s.close(() => (p ? resolve(p) : reject(new Error("no port"))));
    });
  });
}

async function evalJs(client: CDP.Client, expr: string): Promise<unknown> {
  return (await client.Runtime.evaluate({ expression: expr, awaitPromise: true, returnByValue: true })).result.value;
}
async function typeInto(client: CDP.Client, sel: string, text: string): Promise<boolean> {
  const v = await evalJs(
    client,
    `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.focus();
      const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(e, ${JSON.stringify(text)});
      e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value; })()`,
  );
  return v === text;
}
const clickBtn = (client: CDP.Client): Promise<unknown> => evalJs(client, `(() => { const b=document.querySelector('#idSIButton9'); if(b){b.click();return true;} return false; })()`);

/** Drive the MSAL loopback sign-in: fill email/password, accept KMSI/consent, until the browser
 *  redirects to the localhost loopback (where MSAL captures the auth code). */
async function driveMsalLogin(authUrl: string, u: { username: string; password: string }): Promise<void> {
  const profile = path.join(os.tmpdir(), "dvpt-msal-login");
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const port = await freePort();
  const child = cp.spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--new-window", authUrl], { stdio: "ignore" });
  try {
    let client: CDP.Client | undefined;
    for (let i = 0; i < 40 && !client; i++) {
      try {
        client = await CDP({ port });
      } catch {
        await sleep(400);
      }
    }
    if (!client) throw new Error("no CDP for MSAL login browser");
    await client.Runtime.enable();
    const deadline = Date.now() + 90000;
    let lastSig = "";
    while (Date.now() < deadline) {
      const s = JSON.parse(
        (await evalJs(
          client,
          `JSON.stringify((()=>{const q=s=>document.querySelector(s);const vis=e=>!!(e&&e.offsetParent!==null&&!e.disabled);const t=document.body?document.body.innerText:'';return{
            host:location.host, email:vis(q('input[name=loginfmt]')), pass:vis(q('input[name=passwd]')),
            consent:/permissions requested|consent|let this app|accepting these permissions/i.test(t),
            kmsi:/stay signed in\\?/i.test(t)||!!q('#KmsiCheckboxField'), btn:!!q('#idSIButton9') };})())`,
        )) as string,
      );
      const sig = `${s.host}|e${+s.email}|p${+s.pass}|c${+s.consent}|k${+s.kmsi}`;
      if (sig !== lastSig) {
        log(`sign-in ${sig}`);
        lastSig = sig;
      }
      if (s.host === "localhost" || s.host.startsWith("localhost:")) {
        log("reached loopback redirect");
        await sleep(1500);
        return;
      }
      if (s.pass) {
        if (await typeInto(client, "input[name=passwd]", u.password)) await clickBtn(client);
        await sleep(2500);
      } else if (s.email) {
        if (await typeInto(client, "input[name=loginfmt]", u.username)) await clickBtn(client);
        await sleep(2500);
      } else if (s.consent || s.kmsi) {
        await clickBtn(client); // Accept / Yes
        await sleep(2000);
      } else {
        await sleep(1500);
      }
    }
    log("WARNING: sign-in did not reach the loopback within timeout");
  } finally {
    // give MSAL a moment to capture the code before the browser dies
    await sleep(500);
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

suite("Interactive (OAuth) auth → real Dataverse", () => {
  const e = env as LiveEnv;
  const u = user!;
  const client = new LiveDataverseClient(e);
  const BUNDLE = "dvpt_interactive_probe.js";
  let token = "";

  beforeAll(async () => {
    await client.connect();
    // The extension's interactive flow calls vscode.env.openExternal(uri) with the MSAL auth URL.
    (vscode as unknown as { env: unknown }).env = {
      openExternal: async (uri: { fsPath?: string; toString?: () => string }) => {
        const url = (uri.fsPath && uri.fsPath.startsWith("http") ? uri.fsPath : undefined) ?? (uri.toString ? uri.toString() : String(uri));
        await driveMsalLogin(url, u);
        return true;
      },
    };
  }, 120000);

  afterAll(async () => {
    try {
      const found = await client.findWebresourceByName(BUNDLE);
      if (found) {
        await client.deleteWebresource(found.webresourceid);
        await client.publishAll();
        log("cleaned up interactive probe webresource");
      }
    } catch (err) {
      log(`cleanup error: ${(err as Error).message}`);
    }
  }, 60000);

  it(
    "acquires an interactive user token and writes to Dataverse with it",
    async () => {
      log(`acquiring an interactive-user token …`);
      const res = await acquireInteractiveToken(e.url, undefined, true);
      expect(res?.accessToken, "interactive token acquisition returned nothing").toBeTruthy();
      token = res!.accessToken;
      log(`got interactive token (len ${token.length}); deploying a web resource with it`);

      const ctx = {
        projectSettings: { prefix: "dvpt", tenantId: e.tenantId },
        dataverse: { organizationUrl: e.url, isValid: true, authorizationToken: token, getAuthorizationToken: async () => token },
        channel: { appendLine: log, show: () => undefined },
      } as unknown as DataversePowerToolsContext;

      const wr = new DataverseWebresource(BUNDLE, ctx);
      await wr.upsert(Buffer.from("// deployed via interactive-user auth\n", "utf8").toString("base64"), 3, "dvpt interactive probe");
      await client.publishAll();

      const found = await client.findWebresourceByName(BUNDLE);
      expect(found, "web resource was not created using the interactive-user token").toBeTruthy();
      log("verified: web resource created in Dataverse using the interactive-user token ✓");
    },
    5 * 60 * 1000,
  );
});
