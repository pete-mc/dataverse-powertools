/* eslint-disable @typescript-eslint/naming-convention */ // CDP domain names (Fetch, Page) are PascalCase by protocol convention.
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import CDP = require("chrome-remote-interface");
import DataversePowerToolsContext from "../../context";
import { resolveBrowser, BrowserPreference } from "./browserResolver";
import { buildBrowserArgs } from "./browserArgs";
import { isWebresourceBundleUrl, bundleCdpPattern, bundleContentType } from "./webresourceUrlMatch";
import { buildAttachDebugConfig } from "./debugConfig";
import { activeComponentRoot } from "../../components/componentDiscovery";
import { findFreePort, killProcessTree, connectCdpWithRetry } from "./cdpProcess";
import { webresourceLibraryName, libraryBaseFor } from "../libraryNames";

// "Debug Web Resources": run the local webpack bundle *inside the real model-driven app*.
// A dedicated Edge/Chrome instance is launched under the DevTools Protocol; the browser's
// request for the deployed bundle is intercepted and fulfilled from the local build, so
// the live form runs your local code. `webpack --watch` rebuilds on save and the page is
// reloaded. VS Code's JS debugger attaches to the same port for breakpoints in TypeScript.
//
// Nothing is written to the server — the interception is ephemeral and browser-scoped
// (see #64), so there is no prod-promotion or MITM-cert footprint.

interface ActiveDebugSession {
  dispose(): Promise<void>;
}

let activeSession: ActiveDebugSession | undefined;

// Watch-build with `npx` so the project's LOCAL webpack is used (a bare `webpack` fails with
// "'webpack' is not recognized" without a global install). Exported so a unit test pins the `npx`
// launcher against a regression back to bare `webpack` (the e2e VM's global webpack masks it).
export const WEBPACK_WATCH_LAUNCHER = "npx";
// Breakpoint binding (#96) comes from the TEMPLATE's inline-source-map dev
// config. Do NOT force --devtool here: overriding a project's own devtool
// changed the watch output mid-session and broke the comprehensive e2e's
// serve-local step; existing projects switch by editing webpack.dev.js.
export const WEBPACK_WATCH_ARGS = ["webpack", "--config", "webpack.dev.js", "--watch"];

export async function debugWebResources(context: DataversePowerToolsContext): Promise<void> {
  // Re-running restarts cleanly: stop the previous session (browser, webpack
  // watch, CDP) and continue — the old prompt-and-bail forced a second
  // invocation and, before the teardown fixes, a full reload (#96).
  if (activeSession) {
    context.channel.appendLine("[debug] Stopping the previous debug session before starting a new one.");
    await stopDebugWebResources();
  }
  ensureTerminateHook(context);

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Open a Web Resources project folder before debugging.");
    return;
  }
  const workspaceFolder = folders[0];
  const workspacePath = activeComponentRoot(context) ?? workspaceFolder.uri.fsPath;

  // Need a live connection to know the org URL to open.
  if (!context.dataverse || !context.dataverse.isValid) {
    const initialised = context.dataverse ? await context.dataverse.initialize() : false;
    if (!initialised) {
      vscode.window.showErrorMessage("Connect to Dataverse before debugging web resources.");
      return;
    }
  }
  const orgUrl = context.dataverse.organizationUrl;
  if (!orgUrl) {
    vscode.window.showErrorMessage("No Dataverse organisation URL is available. Check the connection and try again.");
    return;
  }

  const prefix = context.projectSettings.prefix;
  if (!prefix) {
    vscode.window.showErrorMessage("This project has no solution prefix configured, so the bundle name is unknown.");
    return;
  }
  // The bundle name is per-component (#258), not a fixed "library" — it drives the CDP intercept
  // pattern, the URL match against the live app, AND the hot-reload watcher's filename check, so
  // hardcoding it made the whole debug session a no-op for any component with its own name:
  // nothing to serve, nothing intercepted, no reload.
  const bundleName = webresourceLibraryName(prefix, "bundle", "library.ts", libraryBaseFor(context.projectSettings));
  const binDir = path.join(workspacePath, "bin");
  const bundlePath = path.join(binDir, bundleName);

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

  // Track everything we start so teardown is total.
  let webpackProc: cp.ChildProcess | undefined;
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
    // Kill the whole tree — webpack is shell-wrapped on Windows, so a plain kill would orphan the
    // `node --watch` child (it would keep rebuilding and holding memory after the session stops).
    killProcessTree(webpackProc);
    killProcessTree(browserProc);
    context.channel.appendLine("Web Resources debug session stopped.");
  };

  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Starting Web Resources debug session…" }, async () => {
    // 1. Rebuild-on-save via the project's LOCAL webpack (see WEBPACK_WATCH_LAUNCHER). npx/webpack
    //    are .cmd shims on Windows, so this needs a shell there.
    webpackProc = cp.spawn(WEBPACK_WATCH_LAUNCHER, WEBPACK_WATCH_ARGS, {
      cwd: workspacePath,
      shell: process.platform === "win32",
    });
    webpackProc.stdout?.on("data", (d) => context.channel.appendLine(`[webpack] ${String(d).trimEnd()}`));
    webpackProc.stderr?.on("data", (d) => context.channel.appendLine(`[webpack] ${String(d).trimEnd()}`));

    // 2. Persistent profile so the Dataverse login survives between sessions.
    const userDataDir = path.join(context.vscode.globalStorageUri.fsPath, "webresource-debug-profile");
    fs.mkdirSync(userDataDir, { recursive: true });

    // 3. One port serves both interception and the VS Code debugger.
    const port = await findFreePort();

    // 4. Launch the browser on a BLANK page — the org is navigated to only
    //    after interception is fully armed (step 5). Launching straight at the
    //    org forced a reload after arming, and that reload raced the app's
    //    boot, occasionally wedging the first load (user report).
    browserProc = cp.spawn(browser.executablePath, buildBrowserArgs({ port, userDataDir, url: "about:blank", extraArgs }), {
      detached: false,
      stdio: "ignore",
    });
    browserProc.on("exit", () => void stopDebugWebResources());

    // 5. Connect CDP and intercept the bundle request.
    client = await connectCdpWithRetry(port, 20000);
    const { Fetch, Page, Network } = client;
    await Page.enable();
    // Model-driven apps register a service worker (/uclient/sw.js) that serves web-resource
    // bundles from a "WebResources" Cache Storage keyed by the versioned /%7b..%7d/webresources/
    // URL. That cache sits ABOVE the network layer, so page-level Fetch interception never sees a
    // form's bundle request and the deployed copy wins — even with the HTTP cache disabled.
    // Bypassing the service worker forces every request onto the network, where interception can
    // fulfil it from local disk. Without this, Debug Web Resources works for a direct web-resource
    // URL but NOT for real form onload scripts (found via a live Account-form test, #64).
    await Network.enable();
    await Network.setBypassServiceWorker({ bypass: true });
    await Fetch.enable({ patterns: [{ urlPattern: bundleCdpPattern(bundleName), requestStage: "Request" }] });

    Fetch.requestPaused(async (params) => {
      const requestId = params.requestId;
      try {
        if (isWebresourceBundleUrl(params.request.url, bundleName) && fs.existsSync(bundlePath)) {
          const body = fs.readFileSync(bundlePath).toString("base64");
          await Fetch.fulfillRequest({
            requestId,
            responseCode: 200,

            responseHeaders: [
              { name: "Content-Type", value: bundleContentType(bundleName) },
              { name: "Cache-Control", value: "no-store" },
            ],

            body,
          });
          context.channel.appendLine(`[debug] served local ${bundleName} into the live app`);
        } else {
          await Fetch.continueRequest({ requestId });
        }
      } catch (error: any) {
        context.channel.appendLine(`[debug] interception error: ${error?.message || error}`);
        try {
          await Fetch.continueRequest({ requestId });
        } catch {
          /* the request may already be gone */
        }
      }
    });

    client.on("disconnect", () => void stopDebugWebResources());

    // Interception is armed and the browser still sits on about:blank — the
    // FIRST navigation to the org now happens with everything in place, so no
    // reload (and no reload race) is needed.
    await Page.navigate({ url: orgUrl });

    // The first load occasionally wedges mid-navigation (readyState stuck at
    // "loading" with an empty body) — user report + e2e evidence. A plain
    // reload doesn't recover a stuck main-document request: stop loading and
    // reload again, up to twice, so the user never has to rescue the browser.
    void (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 20000));
        if (disposed) {
          return;
        }
        try {
          const state = await client!.Runtime.evaluate({
            expression: `JSON.stringify({ready: document.readyState, bodyLen: document.body ? document.body.innerText.length : 0})`,
            returnByValue: true,
          });
          const { ready, bodyLen } = JSON.parse((state.result.value as string) || "{}");
          if (ready === "complete" || bodyLen > 0) {
            return;
          }
          context.channel.appendLine(`[debug] page appears stuck loading — recovering (attempt ${attempt + 1}).`);
          await client!.Page.stopLoading();
          await client!.Page.reload({ ignoreCache: true });
        } catch {
          return; // session ending / page navigating — leave it alone
        }
      }
    })();

    // 6. Hot refresh: on rebuild, reload the page (debounced).
    fs.mkdirSync(binDir, { recursive: true });
    fsWatcher = fs.watch(binDir, (_event, filename) => {
      if (filename !== bundleName) {
        return;
      }
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      reloadTimer = setTimeout(() => {
        context.channel.appendLine("[debug] bundle rebuilt — reloading");
        Page.reload({ ignoreCache: true }).catch(() => undefined);
      }, 400);
    });

    // 7. Attach the VS Code JS debugger (best-effort — interception + hot reload work
    //    regardless of whether the debugger attaches).
    try {
      attachStartedAt = Date.now();
      await vscode.debug.startDebugging(workspaceFolder, buildAttachDebugConfig(browser.kind, port, workspacePath, prefix) as vscode.DebugConfiguration);
    } catch (error: any) {
      context.channel.appendLine(`[debug] could not attach the VS Code debugger (interception still active): ${error?.message || error}`);
    }

    activeSession = { dispose };
    notifySessionChanged();
    // Surface the DevTools port so it's unambiguous which browser is the debug session (a developer
    // can attach their own tools; the e2e reads it here rather than guessing among browser processes).
    context.channel.appendLine(`[debug] DevTools endpoint on port ${port}`);
    context.channel.appendLine(
      `Web Resources debug session started with ${browser.kind === "chrome" ? "Chrome" : "Edge"}. Log in, open your form, and edits will hot-reload the local ${bundleName}.`,
    );
    context.channel.show();
    vscode.window.showInformationMessage("Web Resources debug session started — the live app is now running your local bundle.");
  });
}

/** Stop the running debug session (browser, webpack --watch, CDP, watchers). Safe to call when none is active. */
export async function stopDebugWebResources(): Promise<void> {
  const session = activeSession;
  if (!session) {
    return;
  }
  activeSession = undefined;
  notifySessionChanged();
  await session.dispose();
}

// Stopping the DEBUGGER from VS Code's toolbar must tear down the whole stack
// (browser, webpack watch, CDP) too — otherwise the next run finds a stale
// half-session (#96). The attach itself is BEST-EFFORT: when it dies within
// the grace period (headless environments, js-debug hiccups), interception and
// hot reload must survive — only a deliberate stop after a real attach tears
// down. (The e2e's step 8 caught the ungated version killing the session.)
const ATTACH_GRACE_MS = 10000;
let attachStartedAt = 0;
let terminateHookRegistered = false;
function ensureTerminateHook(context: DataversePowerToolsContext): void {
  if (terminateHookRegistered) {
    return;
  }
  terminateHookRegistered = true;
  context.vscode.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (!activeSession || session.name !== "Dataverse PowerTools: Debug Web Resources") {
        return;
      }
      if (Date.now() - attachStartedAt < ATTACH_GRACE_MS) {
        context.channel.appendLine("[debug] the VS Code debugger detached early — interception + hot reload still active (Stop Debug Web Resources to end the session).");
        return;
      }
      void stopDebugWebResources();
    }),
  );
}

// Session-state surface for the actions panel (#100 v2): a live debug session
// (webpack watch + browser) is state the UI must show, with a Stop control.
let sessionChanged: (() => void) | undefined;

export function isDebugSessionActive(): boolean {
  return activeSession !== undefined;
}

export function onDebugSessionChanged(listener: () => void): void {
  sessionChanged = listener;
}

function notifySessionChanged(): void {
  try {
    sessionChanged?.();
  } catch {
    /* panel refresh must never break the debug flow */
  }
}
