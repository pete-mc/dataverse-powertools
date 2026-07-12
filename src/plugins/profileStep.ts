import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import DataversePowerToolsContext from "../context";
import { WebApiClient, StepSnapshot, enableStepProfiling, disableStepProfiling, stepsForAssemblyQuery, PROFILED_NAME_SUFFIX } from "../general/dataverse/profilerToggle";
import { dataverseApiUrl } from "../general/dataverse/webApi";
import { canCallDataverseApi } from "../general/dataverse/connectionReady";
import { isProfilerInstalled } from "../general/dataverse/pluginProfiles";
import { activeComponentRoot } from "../components/componentDiscovery";

// Profile / stop profiling a plug-in step (#63 phase 2b) with non-negotiable
// safety rails: a FULL pre-change backup of the step persisted to
// .dvpt-profiler-backup.json (and workspaceState) BEFORE anything is touched;
// only steps of the project's OWN assembly are offered; a step with an
// un-restored backup is refused; Repair Profiled Steps restores everything.

const BACKUP_FILE = ".dvpt-profiler-backup.json";
const STATE_KEY = "dataverse-powertools.profilerBackups";

interface BackupStore {
  [stepId: string]: StepSnapshot;
}

function backupPath(componentRoot: string): string {
  return path.join(componentRoot, BACKUP_FILE);
}

async function readBackups(componentRoot: string): Promise<BackupStore> {
  try {
    return JSON.parse(await fs.promises.readFile(backupPath(componentRoot), "utf8")) as BackupStore;
  } catch {
    return {};
  }
}

async function writeBackups(context: DataversePowerToolsContext, componentRoot: string, store: BackupStore): Promise<void> {
  if (Object.keys(store).length === 0) {
    await fs.promises.rm(backupPath(componentRoot), { force: true });
  } else {
    await fs.promises.writeFile(backupPath(componentRoot), JSON.stringify(store, undefined, 2));
  }
  await context.vscode.workspaceState.update(STATE_KEY, store);
}

/** Web API client over the extension's live connection. */
function webApiClientFor(context: DataversePowerToolsContext): WebApiClient | undefined {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    vscode.window.showErrorMessage("Not connected to Dataverse.");
    return undefined;
  }
  const headers = async () => ({
    /* eslint-disable @typescript-eslint/naming-convention */
    Authorization: "Bearer " + (await dataverse.getAuthorizationToken()),
    "Content-Type": "application/json",
    /* eslint-enable @typescript-eslint/naming-convention */
  });
  return {
    async get(resourcePath: string) {
      const response = await fetch(dataverseApiUrl(dataverse.organizationUrl, resourcePath), { method: "GET", headers: await headers() });
      if (!response.ok) {
        throw new Error(`GET ${resourcePath} failed: ${response.status} ${await response.text()}`);
      }
      return response.json();
    },
    async post(resourcePath: string, body: Record<string, unknown>) {
      const response = await fetch(dataverseApiUrl(dataverse.organizationUrl, resourcePath), { method: "POST", headers: await headers(), body: JSON.stringify(body) });
      if (!response.ok) {
        throw new Error(`POST ${resourcePath} failed: ${response.status} ${await response.text()}`);
      }
      return response.headers.get("odata-entityid")?.match(/\(([0-9a-f-]{36})\)/i)?.[1];
    },
    async patch(resourcePath: string, body: Record<string, unknown>) {
      const response = await fetch(dataverseApiUrl(dataverse.organizationUrl, resourcePath), { method: "PATCH", headers: await headers(), body: JSON.stringify(body) });
      if (!response.ok) {
        throw new Error(`PATCH ${resourcePath} failed: ${response.status} ${await response.text()}`);
      }
    },
    async del(resourcePath: string) {
      const response = await fetch(dataverseApiUrl(dataverse.organizationUrl, resourcePath), { method: "DELETE", headers: await headers() });
      if (!response.ok && response.status !== 404) {
        throw new Error(`DELETE ${resourcePath} failed: ${response.status} ${await response.text()}`);
      }
    },
  };
}

/** @param typeNameFilter CodeLens scope (#112): only this class's steps are offered. */
export async function profilePluginStep(context: DataversePowerToolsContext, typeNameFilter?: string): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  const client = componentRoot ? webApiClientFor(context) : undefined;
  if (!componentRoot || !client) {
    return;
  }
  if ((await isProfilerInstalled(context)) !== true) {
    vscode.window.showWarningMessage("The Plugin Profiler solution isn't installed in this environment — install it once via the Plugin Registration Tool, then retry.");
    return;
  }

  // Only the project's OWN assembly's steps are ever offered (safety rail).
  const assemblyName = context.projectSettings.pluginProjectName;
  if (!assemblyName) {
    vscode.window.showErrorMessage("No plugin project name in settings — cannot scope steps to this project's assembly.");
    return;
  }
  const steps = (await client.get(stepsForAssemblyQuery(assemblyName))).value as any[];
  const backups = await readBackups(componentRoot);
  // Offer ENABLED steps only (a disabled step is likely already profiled — its
  // profiler copy is the active one); optionally scope to a class (CodeLens).
  const candidates = steps.filter((step) => step.statecode === 0).filter((step) => !typeNameFilter || step.plugintypeid?.typename === typeNameFilter);
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(
      steps.length > 0 ? "All of this project's steps are already profiled (or disabled)." : `No registered steps found for assembly '${assemblyName}' — deploy first.`,
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    candidates.map((step) => ({ label: step.name as string, target: step })),
    { placeHolder: "Profile which step? (captures persist to the Plug-in Profile table)", ignoreFocusOut: true },
  );
  if (!pick) {
    return;
  }
  const stepId = pick.target.sdkmessageprocessingstepid as string;
  if (backups[stepId]) {
    vscode.window.showErrorMessage("This step has an UN-RESTORED profiler backup — run 'Repair Profiled Steps' first.");
    return;
  }

  // enableStepProfiling creates the profiler step (id known only on return) and
  // rolls itself back on partial failure — so persist the backup once it succeeds.
  let snapshot: StepSnapshot;
  try {
    snapshot = await enableStepProfiling(client, stepId, randomUUID());
  } catch (error: any) {
    vscode.window.showErrorMessage(`Could not enable profiling: ${error?.message ?? error}`);
    return;
  }
  backups[stepId] = snapshot;
  await writeBackups(context, componentRoot, backups);
  context.channel.appendLine(`[Profiler] Step '${snapshot.name}' now routes through the profiler (backup in ${BACKUP_FILE}).`);
  vscode.window.showInformationMessage(`Profiling '${backups[stepId].name}' — trigger it, then run Download Captured Profiles. Stop profiling when done.`);
}

/** @param typeNameFilter CodeLens scope (#112): only this class's backups are offered. */
export async function stopProfilingPluginStep(context: DataversePowerToolsContext, typeNameFilter?: string): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  const client = componentRoot ? webApiClientFor(context) : undefined;
  if (!componentRoot || !client) {
    return;
  }
  const backups = await readBackups(componentRoot);
  const entries = Object.values(backups).filter((snapshot) => !typeNameFilter || snapshot.typename === typeNameFilter);
  if (entries.length === 0) {
    vscode.window.showInformationMessage("No profiled steps recorded for this project.");
    return;
  }
  const pick =
    entries.length === 1
      ? { target: entries[0] }
      : await vscode.window.showQuickPick(
          entries.map((snapshot) => ({ label: snapshot.name, target: snapshot })),
          { placeHolder: "Stop profiling which step?", ignoreFocusOut: true },
        );
  if (!pick) {
    return;
  }
  await restoreOne(context, client, componentRoot, backups, pick.target);
}

/** Restore EVERY backed-up step (the recovery rail). */
export async function repairProfiledSteps(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  const client = componentRoot ? webApiClientFor(context) : undefined;
  if (!componentRoot || !client) {
    return;
  }
  const backups = await readBackups(componentRoot);
  const entries = Object.values(backups);
  if (entries.length === 0) {
    vscode.window.showInformationMessage("No profiler backups to repair from.");
    return;
  }
  for (const snapshot of entries) {
    await restoreOne(context, client, componentRoot, backups, snapshot);
  }
}

async function restoreOne(context: DataversePowerToolsContext, client: WebApiClient, componentRoot: string, backups: BackupStore, snapshot: StepSnapshot): Promise<void> {
  try {
    await disableStepProfiling(client, snapshot);
    // Verify: the profiler step is gone and the original is re-enabled.
    const original = await client.get(`sdkmessageprocessingsteps(${snapshot.originalStepId})?$select=statecode`);
    if (original.statecode !== 0) {
      vscode.window.showErrorMessage(`Restore of '${snapshot.name}' did not re-enable the original step — backup kept. See the output.`);
      context.channel.appendLine(`[Profiler] MISMATCH restoring ${snapshot.originalStepId}: statecode=${original.statecode}`);
      context.channel.show();
      return;
    }
    delete backups[snapshot.originalStepId];
    await writeBackups(context, componentRoot, backups);
    context.channel.appendLine(`[Profiler] Stopped profiling '${snapshot.name}' — profiler step removed, original re-enabled.`);
    vscode.window.showInformationMessage(`Stopped profiling '${snapshot.name}' (original step restored).`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Could not restore '${snapshot.name}': ${error?.message ?? error} — backup kept in ${BACKUP_FILE}.`);
  }
}

export { PROFILED_NAME_SUFFIX };
