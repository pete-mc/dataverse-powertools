/* eslint-disable @typescript-eslint/naming-convention */ // CDP domain names (Fetch, Page, Network) are PascalCase by protocol convention.
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import CDP = require("chrome-remote-interface");
import DataversePowerToolsContext from "../../context";
import { resolveBrowser, BrowserPreference } from "../../webresources/debug/browserResolver";
import { buildBrowserArgs } from "../../webresources/debug/browserArgs";
import { findFreePort, killProcessTree, connectCdpWithRetry } from "../../webresources/debug/cdpProcess";
import { activeComponentRoot } from "../../components/componentDiscovery";
import { findControlDir, findPcfProjectRoot, readControlManifest } from "../controlManifest";
import { isPcfBundleUrl, pcfBundleCdpPattern, pcfBundleContentType, pcfLocalBundlePath } from "./pcfBundleUrl";

// "Debug PCF (live form)": run a locally-built PCF control INSIDE the real model-driven app —
// the live-form half of #141 #5 (the standalone harness is the other half, `npm start watch`).
// It reuses the exact web-resource debug plumbing (#64): launch Edge/Chrome under CDP, bypass the
// model-driven app's service worker, and intercept the DEPLOYED control's bundle.js request,
// fulfilling it from the local pcf-scripts build (out/controls/<Constructor>/bundle.js). A build
// --watch rebuilds on save and the page reloads. Nothing is written to the server (ephemeral,
// browser-scoped) — the CDP analogue of the official Fiddler/Requestly AutoResponder debug flow.
//
// The control must already be DEPLOYED (pac pcf push) and added to a form; this redirects its
// bundle to your local build. Build in development mode so the bundle stays small enough to serve.

interface ActivePcfDebugSession {
  dispose(): Promise<void>;
}

let activeSession: ActivePcfDebugSession | undefined;

// Rebuild-on-save via the project's LOCAL pcf-scripts build in watch mode → out/controls/.../bundle.js
// (the DEPLOYABLE bundle, not the test-harness output). `npm run build -- --watch` runs the project's
// pcf-scripts; npm is a `.cmd` shim on Windows, hence shell:true at the spawn site.
export const PCF_WATCH_LAUNCHER = "npm";
export const PCF_WATCH_ARGS = ["run", "build", "--", "--watch"];

export function isPcfDebugSessionActive(): boolean {
  return activeSession !== undefined;
}

/** Stop the running PCF live-form debug session (browser, pcf build watch, CDP, watchers). */
export async function stopPcfLiveDebug(): Promise<void> {
  const session = activeSession;
  if (!session) {
    return;
  }
  activeSession = undefined;
  await session.dispose();
}

export async function debugPcfLiveForm(context: DataversePowerToolsContext): Promise<void> {
  if (activeSession) {
    context.channel.appendLine("[pcf-debug] Stopping the previous live-form session before starting a new one.");
    await stopPcfLiveDebug();
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Open a PCF component folder before debugging.");
    return;
  }
  const workspaceFolder = folders[0];
  const componentRoot = activeComponentRoot(context) ?? workspaceFolder.uri.fsPath;
  const controlDir = findControlDir(componentRoot);
  if (!controlDir) {
    vscode.window.showErrorMessage("Couldn't find a ControlManifest.Input.xml — is this a PCF control?");
    return;
  }
  const manifest = readControlManifest(controlDir);
  if (!manifest) {
    vscode.window.showErrorMessage("Couldn't read the control's ControlManifest.Input.xml (namespace/constructor).");
    return;
  }
  // The build/watch runs at the PCF PROJECT root (package.json + .pcfproj + out/), which is
  // a level ABOVE the manifest dir — `pac pcf init` nests the manifest in a <Constructor>/ folder.
  const projectRoot = findPcfProjectRoot(componentRoot) ?? componentRoot;

  // Need a live connection to know the org URL to open (the control must be deployed there).
  if (!context.dataverse || !context.dataverse.isValid) {
    const initialised = context.dataverse ? await context.dataverse.initialize() : false;
    if (!initialised) {
      vscode.window.showErrorMessage("Connect to Dataverse before debugging a PCF control on a live form.");
      return;
    }
  }
  const orgUrl = context.dataverse.organizationUrl;
  if (!orgUrl) {
    vscode.window.showErrorMessage("No Dataverse organisation URL is available. Check the connection and try again.");
    return;
  }

  const bundlePath = pcfLocalBundlePath(projectRoot, manifest.constructor);
  const bundleDir = path.dirname(bundlePath);

  const settings = vscode.workspace.getConfiguration("dataverse-powertools");
  const prefer = (settings.get<string>("debugBrowser") || "auto") as BrowserPreference;
  const overridePath = settings.get<string>("debugBrowserPath") || undefined;
  const extraArgs = settings.get<string[]>("debugBrowserArgs") || [];
  let browser;
  try {
    browser = resolveBrowser(prefer, overridePath, { platform: process.platform, env: process.env, exists: fs.existsSync });
  } catch (error: any) {
    vscode.window.showErrorMessage(error?.message || "Could not find a browser to debug with.");
    return;
  }

  let watchProc: cp.ChildProcess | undefined;
  let browserProc: cp.ChildProcess | undefined;
  let client: CDP.Client | undefined;
  let fsWatcher: fs.FSWatcher | undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  let disposed = false;

  const dispose = async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    try {
      fsWatcher?.close();
    } catch {
      /* ignore */
    }
    try {
      await client?.close();
    } catch {
      /* ignore */
    }
    killProcessTree(watchProc);
    killProcessTree(browserProc);
    context.channel.appendLine("PCF live-form debug session stopped.");
  };

  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Starting PCF live-form debug session…" }, async () => {
    // 1. pcf-scripts build --watch → out/controls/<Constructor>/bundle.js on every save.
    //    Runs at the project root (where package.json / pcf-scripts live), NOT the manifest dir.
    watchProc = cp.spawn(PCF_WATCH_LAUNCHER, PCF_WATCH_ARGS, { cwd: projectRoot, shell: process.platform === "win32" });
    watchProc.stdout?.on("data", (d) => context.channel.appendLine(`[pcf build] ${String(d).trimEnd()}`));
    watchProc.stderr?.on("data", (d) => context.channel.appendLine(`[pcf build] ${String(d).trimEnd()}`));

    // 2. Persistent browser profile so the Dataverse login survives between sessions.
    const userDataDir = path.join(context.vscode.globalStorageUri.fsPath, "pcf-debug-profile");
    fs.mkdirSync(userDataDir, { recursive: true });

    // 3. One port serves both interception and the VS Code debugger.
    const port = await findFreePort();

    // 4. Launch on about:blank; navigate only after interception is armed (avoids a reload race).
    browserProc = cp.spawn(browser.executablePath, buildBrowserArgs({ port, userDataDir, url: "about:blank", extraArgs }), { detached: false, stdio: "ignore" });
    browserProc.on("exit", () => void stopPcfLiveDebug());

    // 5. Connect CDP, bypass the service worker (#64), intercept the deployed control's bundle.
    client = await connectCdpWithRetry(port, 20000);
    const { Fetch, Page, Network } = client;
    await Page.enable();
    await Network.enable();
    await Network.setBypassServiceWorker({ bypass: true });
    await Fetch.enable({ patterns: [{ urlPattern: pcfBundleCdpPattern(), requestStage: "Request" }] });

    Fetch.requestPaused(async (params) => {
      const requestId = params.requestId;
      try {
        if (isPcfBundleUrl(params.request.url, manifest.namespace, manifest.constructor) && fs.existsSync(bundlePath)) {
          const body = fs.readFileSync(bundlePath).toString("base64");
          await Fetch.fulfillRequest({
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: pcfBundleContentType() },
              { name: "Cache-Control", value: "no-store" },
            ],
            body,
          });
          context.channel.appendLine(`[pcf-debug] served local bundle.js for ${manifest.namespace}.${manifest.constructor} into the live app`);
        } else {
          await Fetch.continueRequest({ requestId });
        }
      } catch (error: any) {
        context.channel.appendLine(`[pcf-debug] interception error: ${error?.message || error}`);
        try {
          await Fetch.continueRequest({ requestId });
        } catch {
          /* the request may already be gone */
        }
      }
    });

    client.on("disconnect", () => void stopPcfLiveDebug());

    await Page.navigate({ url: orgUrl });

    // 6. Hot refresh: reload the page when the built bundle changes (debounced). The build creates
    //    out/controls/<Constructor>/ on first run, so watch the parent until it exists.
    fs.mkdirSync(bundleDir, { recursive: true });
    fsWatcher = fs.watch(bundleDir, (_event, filename) => {
      if (filename && String(filename) !== "bundle.js") {
        return;
      }
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      reloadTimer = setTimeout(() => {
        context.channel.appendLine("[pcf-debug] bundle rebuilt — reloading");
        Page.reload({ ignoreCache: true }).catch(() => undefined);
      }, 400);
    });

    activeSession = { dispose };
    context.channel.appendLine(`[pcf-debug] DevTools endpoint on port ${port}`);
    context.channel.appendLine(
      `PCF live-form debug started with ${browser.kind === "chrome" ? "Chrome" : "Edge"}. Log in, open the form/view with your control, and edits will hot-reload the local bundle. Deploy the control first (pac pcf push) if you haven't.`,
    );
    context.channel.show();
    vscode.window.showInformationMessage("PCF live-form debug started — the live app is now running your local control bundle.");
  });
}
