import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { resolveTestProjectPath } from "./unitTesting";
import { parseDotnetListTests } from "./parseDotnetListTests";
import { locateTest } from "./testSourceLocations";
import { parseTrx, TrxTestResult } from "./parseTrx";
import { buildDotnetTestArgs, buildTestFilterArgs, shouldRunSelection, testRunStateFor, TestSelection } from "./testRunArgs";
import { activeComponentRoot } from "../components/componentDiscovery";
import { scopedTestControllerId } from "../components/discovery";

// One controller per component, keyed by its unique id — re-initialising the same
// component (re-discovery) disposes the stale controller instead of colliding on the id.
const controllersById = new Map<string, vscode.TestController>();

// Test Explorer integration for a plugin project's .NET tests (#84). Discovers tests via
// `dotnet test --list-tests`, runs them via `dotnet test --logger trx` and parses the TRX for live
// per-test results, and offers a Debug profile that launches the test host under the .NET debugger.
// `dotnet` is a real executable (not a .cmd shim), so it is spawned directly.

function workspaceRoot(context: DataversePowerToolsContext): string | undefined {
  return activeComponentRoot(context);
}

function runDotnetCapture(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    cp.execFile("dotnet", args, { cwd, maxBuffer: 1024 * 1024 * 32 }, (_error, stdout, stderr) => {
      // dotnet test exits non-zero when tests fail — we still want the TRX/stdout, so never reject.
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

/**
 * Locate a test's declaration so the TestItem can carry a uri/range (#252) — without them VS Code cannot
 * offer "Run/Debug Test at Cursor" or gutter icons, and clicking a test does not navigate to it.
 *
 * The .NET test adapter reports names only here, so the class/method are found by scanning the test
 * project's own .cs files. Built once per discovery pass and cached; a miss simply leaves the item
 * unlocated, which is exactly the previous behaviour.
 */
function buildSourceIndex(testProjectDir: string): { file: string; text: string }[] {
  const files: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "obj" && entry.name !== "bin" && entry.name !== "node_modules") {
          walk(full);
        }
      } else if (entry.name.endsWith(".cs")) {
        try {
          files.push({ file: full, text: fs.readFileSync(full, "utf8") });
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };
  walk(testProjectDir);
  return files;
}

/** The uri/range for a test, or undefined when its class is not found in the project's sources. */
function locationFor(index: { file: string; text: string }[], className: string, methodName?: string): { uri: vscode.Uri; range: vscode.Range } | undefined {
  for (const entry of index) {
    const found = locateTest(entry.text, className, methodName);
    if (found) {
      return { uri: vscode.Uri.file(entry.file), range: new vscode.Range(found.line, 0, found.line, 0) };
    }
  }
  return undefined;
}

/** classId is the fully-qualified class name; used as the parent TestItem id. */
function classItem(controller: vscode.TestController, className: string, location?: { uri: vscode.Uri; range: vscode.Range }): vscode.TestItem {
  let item = controller.items.get(className);
  if (!item) {
    // Pass the uri at creation — TestItem.uri is read-only afterwards (#252).
    item = controller.createTestItem(className, className, location?.uri);
    controller.items.add(item);
  }
  if (location) {
    item.range = location.range;
  }
  return item;
}

function methodItem(controller: vscode.TestController, className: string, fqn: string, methodName: string, index?: { file: string; text: string }[]): vscode.TestItem {
  const classLocation = index ? locationFor(index, className) : undefined;
  const parent = classItem(controller, className, classLocation);
  const methodLocation = index ? locationFor(index, className, methodName) : undefined;
  let item = parent.children.get(fqn);
  if (!item) {
    item = controller.createTestItem(fqn, methodName, methodLocation?.uri ?? classLocation?.uri);
    parent.children.add(item);
  }
  if (methodLocation) {
    item.range = methodLocation.range;
  }
  return item;
}

async function discover(context: DataversePowerToolsContext, controller: vscode.TestController): Promise<void> {
  const cwd = workspaceRoot(context);
  if (!cwd) {
    return;
  }
  const testProject = await resolveTestProjectPath(context, cwd);
  if (!testProject) {
    controller.items.replace([]);
    return;
  }
  const { stdout } = await runDotnetCapture(["test", testProject, "--list-tests"], cwd);
  const tests = parseDotnetListTests(stdout);
  controller.items.replace([]);
  // Read the test project's sources ONCE, so locating N tests does not re-walk the tree N times (#252).
  const sourceIndex = buildSourceIndex(path.dirname(testProject));
  for (const t of tests) {
    methodItem(controller, t.className, t.fqn, t.methodName, sourceIndex);
  }
}

/** All leaf (method) items under the request, or every discovered method when nothing is specified. */
function collectMethodFqns(controller: vscode.TestController, request: vscode.TestRunRequest): { fqns: string[]; items: vscode.TestItem[] } {
  const items: vscode.TestItem[] = [];
  const roots = request.include ?? [...iterate(controller.items)];
  const visit = (item: vscode.TestItem) => {
    if (item.children.size > 0) {
      for (const [, child] of item.children) {
        visit(child);
      }
    } else {
      items.push(item);
    }
  };
  roots.forEach(visit);
  // A leaf item's id is its fully-qualified name.
  return { fqns: items.map((i) => i.id), items };
}

function* iterate(items: vscode.TestItemCollection): Generator<vscode.TestItem> {
  for (const [, item] of items) {
    yield item;
  }
}

function findItem(controller: vscode.TestController, result: TrxTestResult): vscode.TestItem | undefined {
  // Discovered item ids are fully-qualified names (from --list-tests); the TRX fqn matches directly.
  for (const [, cls] of controller.items) {
    const direct = cls.children.get(result.fqn);
    if (direct) {
      return direct;
    }
  }
  // Fallback: match on the leaf method name if the FQN formatting differs (e.g. data-driven rows).
  const leaf = result.fqn.slice(result.fqn.lastIndexOf(".") + 1);
  for (const [, cls] of controller.items) {
    for (const [, method] of cls.children) {
      if (method.label === leaf) {
        return method;
      }
    }
  }
  return undefined;
}

/**
 * The launch configuration the Debug profile hands to VS Code (pure, unit-tested).
 *
 * `type: "coreclr"` is contributed by the C# extension (ms-dotnettools.csharp) — without it VS Code
 * has no .NET debug adapter and `startDebugging` fails. That is also why the e2e suite's debug steps
 * self-skip when the extension is absent: this config is ours to get right, but the adapter is not
 * ours to provide.
 *
 * Debugging `dotnet test` (rather than the built test dll) is what lets a breakpoint inside the
 * PLUGIN bind: the replay harness runs the plugin in-process, so the test host loads the plugin's own
 * assembly and its symbols.
 */
export function buildDebugLaunchConfig(testProject: string, cwd: string, filter: readonly string[]): vscode.DebugConfiguration {
  return {
    type: "coreclr",
    request: "launch",
    name: "Debug Plugin Tests",
    program: "dotnet",
    args: ["test", testProject, ...filter],
    cwd,
    console: "internalConsole",
    stopAtEntry: false,
  };
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
  const testProject = await resolveTestProjectPath(context, cwd);
  if (!testProject) {
    vscode.window.showErrorMessage("No plugin test project (*.Tests) was found.");
    return;
  }

  const { fqns, items } = collectMethodFqns(controller, request);
  const run = controller.createTestRun(request);
  items.forEach((i) => run.enqueued(i));

  // A VSTest filter targeting exactly the requested tests (omitted to run all).
  const runningAll = !request.include;
  const selection: TestSelection = runningAll ? {} : { fqns };
  const filter = buildTestFilterArgs(selection);

  // A selection that resolved to no test names must not run: with no --filter, `dotnet test` runs
  // the WHOLE suite, so "run this one test" would quietly become "run everything".
  if (!shouldRunSelection(selection)) {
    context.channel.appendLine("[tests] the selection resolved to no tests — nothing to run.");
    run.end();
    return;
  }

  if (debug) {
    await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], buildDebugLaunchConfig(testProject, cwd, filter));
    run.end();
    return;
  }

  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-trx-"));
  const trxName = "results.trx";
  items.forEach((i) => run.started(i));
  context.channel.appendLine(`[tests] running ${runningAll ? "all" : fqns.length + ""} plugin test(s)…`);

  if (token.isCancellationRequested) {
    run.end();
    return;
  }
  await runDotnetCapture(buildDotnetTestArgs({ testProject, trxName, resultsDirectory: resultsDir, selection }), cwd);

  const trxPath = path.join(resultsDir, trxName);
  let results: TrxTestResult[] = [];
  try {
    results = parseTrx(fs.readFileSync(trxPath, "utf8"));
  } catch {
    /* no TRX produced (e.g. build failure) — handled below */
  } finally {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  }

  if (results.length === 0) {
    context.channel.show();
    items.forEach((i) => run.errored(i, new vscode.TestMessage("No test results were produced — see the Dataverse PowerTools output (build error?).")));
    run.end();
    return;
  }

  for (const r of results) {
    const item = findItem(controller, r);
    if (!item) {
      continue;
    }
    const state = testRunStateFor(r.outcome);
    if (state === "passed") {
      run.passed(item, r.durationMs);
    } else if (state === "skipped") {
      run.skipped(item);
    } else {
      const message = new vscode.TestMessage(r.message ? `${r.message}\n${r.stackTrace ?? ""}`.trim() : "Test failed");
      run.failed(item, message, r.durationMs);
    }
  }
  run.end();
}

export function createPluginTestController(context: DataversePowerToolsContext): vscode.TestController {
  // Scope the controller id to the component so two plugin components don't collide
  // ("Attempt to insert a duplicate controller with ID …", #47). Label by folder so the
  // user can tell each component's tests apart in the Test Explorer.
  const id = scopedTestControllerId("dataverse-powertools.pluginTests", activeComponentRoot(context), !context.activeComponent);
  controllersById.get(id)?.dispose();
  const rel = context.activeComponent?.relativeRoot;
  const controller = vscode.tests.createTestController(id, rel ? `Plugin Tests (.NET) — ${rel}` : "Plugin Tests (.NET)");
  controllersById.set(id, controller);
  controller.resolveHandler = async (item) => {
    if (!item) {
      await discover(context, controller);
    }
  };
  controller.refreshHandler = async () => {
    await discover(context, controller);
  };
  controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, (request, token) => void runHandler(context, controller, request, token, false), true);
  controller.createRunProfile("Debug", vscode.TestRunProfileKind.Debug, (request, token) => void runHandler(context, controller, request, token, true), false);
  void discover(context, controller);
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
