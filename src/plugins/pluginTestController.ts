import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { resolveTestProjectPath } from "./unitTesting";
import { parseDotnetListTests } from "./parseDotnetListTests";
import { parseTrx, TrxTestResult } from "./parseTrx";
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

/** classId is the fully-qualified class name; used as the parent TestItem id. */
function classItem(controller: vscode.TestController, className: string): vscode.TestItem {
  let item = controller.items.get(className);
  if (!item) {
    item = controller.createTestItem(className, className);
    controller.items.add(item);
  }
  return item;
}

function methodItem(controller: vscode.TestController, className: string, fqn: string, methodName: string): vscode.TestItem {
  const parent = classItem(controller, className);
  let item = parent.children.get(fqn);
  if (!item) {
    item = controller.createTestItem(fqn, methodName);
    parent.children.add(item);
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
  for (const t of tests) {
    methodItem(controller, t.className, t.fqn, t.methodName);
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

  // A VSTest filter targeting exactly the requested tests (omit to run all).
  const runningAll = !request.include;
  const filter = runningAll ? [] : ["--filter", fqns.map((f) => `FullyQualifiedName=${f}`).join("|")];

  if (debug) {
    await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
      type: "coreclr",
      request: "launch",
      name: "Debug Plugin Tests",
      program: "dotnet",
      args: ["test", testProject, ...filter],
      cwd,
      console: "internalConsole",
      stopAtEntry: false,
    });
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
  await runDotnetCapture(["test", testProject, "--logger", `trx;LogFileName=${trxName}`, "--results-directory", resultsDir, ...filter], cwd);

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
    if (r.outcome === "passed") {
      run.passed(item, r.durationMs);
    } else if (r.outcome === "skipped") {
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
