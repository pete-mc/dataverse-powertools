import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";
import { parseJestJson, extractJestJson, JestAssertion } from "./parseJestJson";
import { jestPathArgs } from "./jestPaths";
import { activeComponentRoot } from "../components/componentDiscovery";
import { scopedTestControllerId } from "../components/discovery";
import { planBatch } from "./continuousRun";

// One controller per component, keyed by its unique id — re-initialising the same
// component (re-discovery) disposes the stale controller instead of colliding on the id.
const controllersById = new Map<string, vscode.TestController>();

// Test Explorer integration for a Web Resources project's Jest tests (#84). Discovers the test files,
// runs them via the project's LOCAL jest (through `npx`, like the webpack build), and reports live
// per-test results — with source locations — into VS Code's Testing API. Debugging launches jest
// under the Node debugger. All disposables hang off context.vscode.subscriptions.

// **/ prefix so tests are found when the webresources project is a nested
// component of a multi-component workspace (#47), not only at the root.
const TEST_GLOB = "**/webresources_src/__tests__/**/*.ts";

function workspaceRoot(context: DataversePowerToolsContext): string | undefined {
  return activeComponentRoot(context);
}

/** Spawn `npx jest …` cross-platform: on Windows go through cmd.exe (jest/npx are .cmd shims that
 *  recent Node refuses to spawn directly — the same EINVAL trap pac hits). Collects stdout; jest
 *  prints its --json report on stdout even when tests fail (non-zero exit), so we never reject. */
function runJest(cwd: string, jestArgs: string[]): Promise<string> {
  const isWin = process.platform === "win32";
  const command = isWin ? "cmd.exe" : "npx";
  const args = isWin ? ["/c", "npx", "jest", ...jestArgs] : ["jest", ...jestArgs];
  return new Promise((resolve) => {
    let out = "";
    const child = cp.spawn(command, args, { cwd });
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve(out));
    child.on("close", () => resolve(out));
  });
}

/** Discover `*.test.ts`-style files under __tests__ as top-level items; per-test children are filled
 *  in from run results (jest is authoritative for titles + locations). */
async function discoverTestFiles(controller: vscode.TestController): Promise<void> {
  const files = await vscode.workspace.findFiles(TEST_GLOB);
  const seen = new Set<string>();
  for (const uri of files) {
    seen.add(uri.fsPath);
    if (!controller.items.get(uri.fsPath)) {
      const label = vscode.workspace.asRelativePath(uri);
      controller.items.add(controller.createTestItem(uri.fsPath, label, uri));
    }
  }
  // Drop items whose file no longer exists.
  for (const [id] of controller.items) {
    if (!seen.has(id)) {
      controller.items.delete(id);
    }
  }
}

function fileItem(controller: vscode.TestController, fsPath: string, uri: vscode.Uri): vscode.TestItem {
  let item = controller.items.get(fsPath);
  if (!item) {
    item = controller.createTestItem(fsPath, vscode.workspace.asRelativePath(uri), uri);
    controller.items.add(item);
  }
  return item;
}

/** Create/update the child TestItem for one assertion under its file item, anchored to its location. */
function upsertTestItem(controller: vscode.TestController, a: JestAssertion): vscode.TestItem | undefined {
  if (!a.file) {
    return undefined;
  }
  // Round-trip through Uri so jest's reported path gets the same drive-letter
  // casing as the discovered items' uri.fsPath ids — otherwise each run would
  // add duplicate file nodes ("C:\…" vs "c:\…") on Windows.
  const uri = vscode.Uri.file(a.file);
  const parent = fileItem(controller, uri.fsPath, uri);
  const fullTitle = [...a.ancestorTitles, a.title].join(" › ");
  const id = `${uri.fsPath}::${fullTitle}`;
  let item = parent.children.get(id);
  if (!item) {
    item = controller.createTestItem(id, fullTitle, uri);
    parent.children.add(item);
  }
  if (a.line !== undefined) {
    const line = Math.max(0, a.line - 1);
    item.range = new vscode.Range(line, a.column ?? 0, line, a.column ?? 0);
  }
  return item;
}

async function runHandler(
  context: DataversePowerToolsContext,
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
  debug: boolean,
): Promise<void> {
  const cwd = workspaceRoot(context);
  if (!cwd) {
    return;
  }

  if (request.continuous) {
    // Continuous ("watch") run (#232): VS Code's own toggle in the Testing view owns the lifecycle — it
    // hands us a token that fires when the user turns it off, so there is nothing to leak. Handled
    // BEFORE creating a run: each re-run makes its own, otherwise the whole watch session would show as
    // one endlessly-queued run.
    await watchAndRerun(context, controller, request, token);
    return;
  }

  const run = controller.createTestRun(request);

  // The set of test files to execute — from the requested items, or all discovered files.
  const files = new Set<string>();
  const requested = request.include ?? [...mapIterable(controller.items)];
  for (const item of requested) {
    if (item.uri) {
      files.add(item.uri.fsPath);
    }
    run.enqueued(item);
  }
  if (files.size === 0) {
    run.end();
    return;
  }

  if (debug) {
    // Launch jest under the Node debugger; results still come back through a normal run below.
    await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
      type: "node",
      request: "launch",
      name: "Debug Web Resource Tests",
      runtimeExecutable: "npx",
      runtimeArgs: ["jest", "--runInBand", ...jestPathArgs(cwd, files)],
      cwd,
      console: "integratedTerminal",
      internalConsoleOptions: "neverOpen",
    });
    run.end();
    return;
  }

  const args = ["--json", "--testLocationInResults", "--ci", ...jestPathArgs(cwd, files)];
  context.channel.appendLine(`[tests] running jest for ${files.size} file(s)…`);
  const stdout = token.isCancellationRequested ? "" : await runJest(cwd, args);
  const assertions = parseJestJson(extractJestJson(stdout));

  if (assertions.length === 0) {
    // Nothing parsed — surface the raw output so the failure is diagnosable, don't silently pass.
    context.channel.appendLine(stdout.trim() || "[tests] jest produced no parseable output");
    context.channel.show();
    for (const item of requested) {
      run.errored(item, new vscode.TestMessage("Jest produced no parseable results — see the Dataverse PowerTools output."));
    }
    run.end();
    return;
  }

  for (const a of assertions) {
    const item = upsertTestItem(controller, a);
    if (!item) {
      continue;
    }
    if (a.status === "passed") {
      run.passed(item, a.durationMs);
    } else if (a.status === "skipped") {
      run.skipped(item);
    } else {
      const message = new vscode.TestMessage(a.message ?? "Test failed");
      if (item.uri && item.range) {
        message.location = new vscode.Location(item.uri, item.range);
      }
      run.failed(item, message, a.durationMs);
    }
  }
  run.end();
}

/**
 * Continuous run: re-run the affected tests whenever the component's TypeScript changes, until the user
 * turns the toggle off (which cancels `token`).
 *
 * Deliberately NOT `jest --watch`: that would hold a long-lived child process, and orphaned watchers
 * are a documented way to starve this project's test VM. Each change instead goes through the ordinary
 * one-shot run path, so nothing survives cancellation but the file watcher, disposed below.
 */
async function watchAndRerun(
  context: DataversePowerToolsContext,
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
): Promise<void> {
  const cwd = workspaceRoot(context);
  if (!cwd) {
    return;
  }
  // Scoped to THIS component's folder, so one component's saves don't re-run another's tests (#47).
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(cwd, "**/*.ts"));
  const pendingChanges: string[] = [];
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  const flush = async (): Promise<void> => {
    const changed = pendingChanges.splice(0, pendingChanges.length);
    const testFiles = planBatch(
      changed,
      [...mapIterable(controller.items)].map((item) => item.uri?.fsPath).filter((p): p is string => Boolean(p)),
    );
    if (testFiles.length === 0 || token.isCancellationRequested) {
      return;
    }
    running = true;
    try {
      // A fresh request per re-run so results land against the right items and the run shows up in the
      // Testing view exactly like a manual one. `continuous: false` — this IS the re-run.
      const items = testFiles.map((file) => fileItem(controller, vscode.Uri.file(file).fsPath, vscode.Uri.file(file)));
      await runHandler(context, controller, new vscode.TestRunRequest(items, undefined, request.profile), token, false);
    } finally {
      running = false;
      if (pendingChanges.length > 0 && !token.isCancellationRequested) {
        void flush();
      }
    }
  };

  const onChange = (uri: vscode.Uri): void => {
    pendingChanges.push(uri.fsPath);
    if (running) {
      return; // flush()'s finally picks it up — never two jest runs at once
    }
    if (timer) {
      clearTimeout(timer);
    }
    // Debounce: a save-all or a branch switch is one run, not one per file.
    timer = setTimeout(() => void flush(), 600);
  };

  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  context.channel.appendLine("[tests] continuous run ON — saving a TypeScript file re-runs the affected tests.");

  await new Promise<void>((resolve) => {
    token.onCancellationRequested(() => {
      if (timer) {
        clearTimeout(timer);
      }
      watcher.dispose();
      context.channel.appendLine("[tests] continuous run OFF.");
      resolve();
    });
  });
}

function* mapIterable(items: vscode.TestItemCollection): Generator<vscode.TestItem> {
  for (const [, item] of items) {
    yield item;
  }
}

export function createWebresourceTestController(context: DataversePowerToolsContext): vscode.TestController {
  // Scope the controller id to the component so two web-resource components don't collide
  // ("Attempt to insert a duplicate controller with ID …", #47). Label by folder so the
  // user can tell each component's tests apart in the Test Explorer.
  const id = scopedTestControllerId("dataverse-powertools.webresourceTests", activeComponentRoot(context), !context.activeComponent);
  controllersById.get(id)?.dispose();
  const rel = context.activeComponent?.relativeRoot;
  const controller = vscode.tests.createTestController(id, rel ? `Web Resource Tests (Jest) — ${rel}` : "Web Resource Tests (Jest)");
  controllersById.set(id, controller);
  controller.resolveHandler = async (item) => {
    if (!item) {
      await discoverTestFiles(controller);
    }
  };
  controller.refreshHandler = async () => {
    await discoverTestFiles(controller);
  };
  // supportsContinuousRun (last arg): adds the Testing view's watch toggle for this profile — off
  // until the user turns it on, which is the "setting" #232 asked for, with an obvious way to stop it.
  controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, (request, token) => void runHandler(context, controller, request, token, false), true, undefined, true);
  controller.createRunProfile("Debug", vscode.TestRunProfileKind.Debug, (request, token) => void runHandler(context, controller, request, token, true), false);
  void discoverTestFiles(controller);
  context.vscode.subscriptions.push({
    dispose: () => {
      controller.dispose();
      if (controllersById.get(id) === controller) {
        controllersById.delete(id);
      }
    },
  });
  return controller;
}
