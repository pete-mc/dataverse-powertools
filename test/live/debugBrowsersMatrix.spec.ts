/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode"; // aliased to test/vscode.mock.ts
import CDP = require("chrome-remote-interface");
import { loadLiveEnv, loadInteractiveTestUser, LiveEnv, testSolutionConfig } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { DataverseWebresource } from "../../src/general/dataverse/DataverseWebresource";
import { DataverseForm } from "../../src/general/dataverse/DataverseForm";
import { debugWebResources, stopDebugWebResources } from "../../src/webresources/debug/debugWebresources";
import { preAuthenticateProfile, findDebugPortByProfile } from "./browserAutoLogin";
import { resolveBrowser } from "../../src/webresources/debug/browserResolver";
import DataversePowerToolsContext from "../../src/context";

// Unattended #64 coverage across BOTH browsers using the interactive test user.
// For each of Edge and Chrome: launch Debug Web Resources (real command) → auto-login →
// open a real Account form → assert the LOCAL onload banner is served (not the deployed
// one) → edit the bundle → assert the form hot-reloads to v2. No human interaction.
//
//   DVPT_DEBUG_DEMO=1 npm run test:live -- test/live/debugBrowsersMatrix.spec.ts
const env = loadLiveEnv();
const user = loadInteractiveTestUser();
const enabled = !!env && !!user && process.env.DVPT_DEBUG_DEMO === "1";
const suite = enabled ? describe : describe.skip;

const BUNDLE = "dvpt_library.js";
const FORM_ID = "8448b78f-8f42-454e-8e2a-f8196b0419af"; // account "Account" main form
const APP_ID = "a6d7419d-7477-f111-ab0d-70a8a54b2854";
const TRIGGER = "{a1b2c3d4-0000-4000-8000-0000000000aa}";
const LIB_UID = "{b2c3d4e5-0000-4000-8000-0000000000bb}";
const FN = "dvpt.DemoForm.onLoad";

const bundleJs = (banner: string): string =>
  `var dvpt=(function(){return{DemoForm:{onLoad:function(ec){try{ec.getFormContext().ui.setFormNotification(${JSON.stringify(banner)},"INFO","dvpt-debug-demo");}catch(e){console.error(e);}}}};})();\n`;
const DEPLOYED = bundleJs(">>> DEPLOYED — banner from the SERVER copy <<<");
const localV1 = (b: string): string => bundleJs(`>>> LOCAL v1 on ${b} — served from disk <<<`);
const localV2 = (b: string): string => bundleJs(`>>> LOCAL v2 on ${b} — HOT-RELOADED <<<`);

function log(m: string): void {
  // eslint-disable-next-line no-console
  console.log(m);
}

function makeContext(url: string, token: string, workspacePath: string, globalStorage: string, browser: string): DataversePowerToolsContext {
  return {
    projectSettings: { prefix: "dvpt", tenantId: (env as LiveEnv).tenantId },
    dataverse: { organizationUrl: url, isValid: true, authorizationToken: token, getAuthorizationToken: async () => token, initialize: async () => true },
    channel: { appendLine: (m: string) => log(`[${browser}] ${m}`), show: () => undefined },
    vscode: { globalStorageUri: { fsPath: globalStorage }, subscriptions: [] as unknown[] },
  } as unknown as DataversePowerToolsContext;
}

/** Register library + onload handler on the Account form via the extension's DataverseForm. */
async function registerHandler(ctx: DataversePowerToolsContext): Promise<void> {
  const form = new DataverseForm(FORM_ID, ctx);
  await form.getFormData();
  const root = form.form.form;
  if (!root.formLibraries) root.formLibraries = { Library: [] };
  if (!root.formLibraries.Library.find((l: any) => l["@_name"] === BUNDLE)) root.formLibraries.Library.push({ "@_name": BUNDLE, "@_libraryUniqueId": LIB_UID });
  if (!root.events) root.events = { event: [] };
  let onload = root.events.event.find((e: any) => e["@_name"] === "onload");
  if (!onload) {
    onload = { "@_name": "onload", "@_active": "true", "@_application": "true", Handlers: { Handler: [] } };
    root.events.event.push(onload);
  }
  if (!onload.Handlers) onload.Handlers = { Handler: [] };
  if (!onload.Handlers.Handler.find((h: any) => h["@_handlerUniqueId"] === TRIGGER)) {
    onload.Handlers.Handler.push({ "@_functionName": FN, "@_libraryName": BUNDLE, "@_handlerUniqueId": TRIGGER, "@_enabled": "true", "@_parameters": "", "@_passExecutionContext": "true" });
  }
  await form.saveForm();
}

async function unregisterHandler(ctx: DataversePowerToolsContext): Promise<void> {
  const form = new DataverseForm(FORM_ID, ctx);
  await form.getFormData();
  const root = form.form.form;
  if (root.formLibraries?.Library) {
    root.formLibraries.Library = root.formLibraries.Library.filter((l: any) => l["@_name"] !== BUNDLE);
    if (root.formLibraries.Library.length === 0) delete root.formLibraries;
  }
  if (root.events?.event) {
    for (const e of root.events.event) if (e.Handlers?.Handler) e.Handlers.Handler = e.Handlers.Handler.filter((h: any) => h["@_libraryName"] !== BUNDLE);
    root.events.event = root.events.event.filter((e: any) => e.Handlers?.Handler?.length > 0);
    if (root.events.event.length === 0) delete root.events;
  }
  await form.saveForm();
}

async function bannerOnForm(port: number, recordUrl: string): Promise<string> {
  const targets = await CDP.List({ port });
  const page = targets.find((t) => t.type === "page");
  const client = await CDP({ port, target: page });
  try {
    await client.Page.enable();
    await client.Runtime.enable();
    await client.Page.navigate({ url: recordUrl });
    await new Promise((r) => setTimeout(r, 18000));
    return (await client.Runtime.evaluate({
      expression: `(document.body.innerText.match(/LOCAL v2[^<]*|LOCAL v1[^<]*|DEPLOYED — banner from the SERVER copy/)||['(none)'])[0]`,
      returnByValue: true,
    })).result.value as string;
  } finally {
    await client.close();
  }
}

async function reloadedBanner(port: number): Promise<string> {
  await new Promise((r) => setTimeout(r, 9000)); // let the feature's debounced hot-reload happen
  const targets = await CDP.List({ port });
  const page = targets.find((t) => t.type === "page");
  const client = await CDP({ port, target: page });
  try {
    await client.Runtime.enable();
    return (await client.Runtime.evaluate({
      expression: `(document.body.innerText.match(/LOCAL v2[^<]*|LOCAL v1[^<]*|DEPLOYED — banner from the SERVER copy/)||['(none)'])[0]`,
      returnByValue: true,
    })).result.value as string;
  } finally {
    await client.close();
  }
}

suite("Debug Web Resources — Edge + Chrome unattended (#64)", () => {
  const e = env as LiveEnv;
  const u = user!;
  const client = new LiveDataverseClient(e);
  const orgHost = new URL(e.url).host;
  const tmpRoot = path.join(os.tmpdir(), "dvpt-debug-matrix");
  let recordUrl = "";

  beforeAll(async () => {
    await client.connect();
    await client.ensureTestSolution(testSolutionConfig(e));
    const setupCtx = makeContext(e.url, client.accessToken, tmpRoot, tmpRoot, "setup");
    const wr = new DataverseWebresource(BUNDLE, setupCtx);
    await wr.upsert(Buffer.from(DEPLOYED, "utf8").toString("base64"), 3, "dvpt library (debug demo)");
    await client.publishAll();
    await registerHandler(setupCtx);
    await client.publishAll();
    // Any existing account record (a create form triggers a beforeunload dialog on reload).
    const res: any = await (await fetch(`${e.url}/api/data/v9.2/accounts?$select=accountid&$top=1`, { headers: { Authorization: `Bearer ${client.accessToken}`, Accept: "application/json" } })).json();
    const accountId = res.value?.[0]?.accountid;
    recordUrl = `${e.url}/main.aspx?appid=${APP_ID}&pagetype=entityrecord&etn=account${accountId ? `&id=${accountId}` : ""}`;
    log(`Setup complete. Account form registered; record: ${accountId ?? "(new)"}`);
  }, 180000);

  afterEach(async () => {
    // Always tear down the session, even when an assertion failed mid-test, so the next
    // browser isn't blocked by a lingering activeSession.
    await stopDebugWebResources();
  });

  afterAll(async () => {
    await stopDebugWebResources();
    try {
      await unregisterHandler(makeContext(e.url, client.accessToken, tmpRoot, tmpRoot, "cleanup"));
      await client.publishAll(); // publish the form revert so the WR dependency clears before delete
      const found = await client.findWebresourceByName(BUNDLE);
      if (found) await client.deleteWebresource(found.webresourceid);
      await client.publishAll();
      log("Cleaned up: form reverted, webresource deleted.");
    } catch (err) {
      log(`cleanup error: ${(err as Error).message}`);
    }
  }, 120000);

  for (const browser of ["msedge", "chrome"] as const) {
    it(
      `serves LOCAL into a real form and hot-reloads on ${browser}`,
      async () => {
        (vscode.workspace as unknown as { getConfiguration: () => unknown }).getConfiguration = () => ({ get: (k: string) => (k === "debugBrowser" ? browser : undefined), update: () => undefined });
        const workspacePath = path.join(tmpRoot, browser, "workspace");
        const binDir = path.join(workspacePath, "bin");
        const bundlePath = path.join(binDir, BUNDLE);
        const globalStorage = path.join(tmpRoot, browser, "globalStorage");
        const profileDir = path.join(globalStorage, "webresource-debug-profile");
        fs.mkdirSync(binDir, { recursive: true });
        fs.mkdirSync(globalStorage, { recursive: true });
        fs.writeFileSync(bundlePath, localV1(browser));
        (vscode.workspace as unknown as { workspaceFolders: unknown[] }).workspaceFolders = [{ uri: { fsPath: workspacePath }, name: "webresource", index: 0 }];

        // Sign the profile in first (clean browser, no interception attached) so the debug
        // session opens already authenticated — like a real developer's persistent profile.
        const resolved = resolveBrowser(browser, undefined, { platform: process.platform, env: process.env, exists: fs.existsSync });
        log(`[${browser}] pre-authenticating the debug profile with the interactive test user`);
        const authed = await preAuthenticateProfile(resolved.executablePath, profileDir, e.url, { username: u.username, password: u.password, orgHost, log });
        expect(authed, `pre-auth failed on ${browser}`).toBe(true);

        const ctx = makeContext(e.url, client.accessToken, workspacePath, globalStorage, browser);
        await debugWebResources(ctx);
        const port = await findDebugPortByProfile(profileDir);
        log(`[${browser}] debug session on port ${port}`);

        const first = await bannerOnForm(port, recordUrl);
        log(`[${browser}] banner on first load: ${first}`);
        expect(first, `expected LOCAL served on ${browser}, got: ${first}`).toContain("LOCAL v1");

        fs.writeFileSync(bundlePath, localV2(browser));
        const after = await reloadedBanner(port);
        log(`[${browser}] banner after edit: ${after}`);
        expect(after, `expected hot reload to v2 on ${browser}, got: ${after}`).toContain("LOCAL v2");

        await stopDebugWebResources();
      },
      6 * 60 * 1000,
    );
  }
});
