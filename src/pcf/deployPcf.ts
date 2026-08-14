import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { runPac } from "../general/modelbuilder/commandRunner";
import { activeComponentRoot } from "../components/componentDiscovery";
import { dataverseApiUrl, logDataverseError, logDataverseHttpError } from "../general/dataverse/webApi";
import { addDataverseSolutionComponent } from "../general/dataverse/addDataverseSolutionComponent";
import { customControlLookup, pickMatchingRow } from "../general/dataverse/rowLookups";
import { CONTROL_MANIFEST_FILENAME, findControlDir } from "./controlManifest";

const SOLUTION_DOCS_URL = "https://learn.microsoft.com/power-apps/developer/component-framework/import-custom-controls";

/** Find the first `.cdsproj` (a pac solution project) in a directory. */
function findCdsproj(directory: string): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const cdsproj = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".cdsproj"));
  return cdsproj ? path.join(directory, cdsproj.name) : undefined;
}

/** Locate a solution project (`.cdsproj`) directory in the workspace: root folders
 * plus their immediate subfolders (the usual monorepo / multi-component layout). */
function findSolutionProjectDir(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath;
    if (findCdsproj(root)) {
      return root;
    }
    let subdirs: fs.Dirent[];
    try {
      subdirs = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of subdirs) {
      if (entry.isDirectory()) {
        const child = path.join(root, entry.name);
        if (findCdsproj(child)) {
          return child;
        }
      }
    }
  }
  return undefined;
}

// A PCF control ships INSIDE a solution. For a release build you add the control's
// pcfproj as a reference to a solution project (`.cdsproj`) and pack/import that.
// For v1 (#141) this command guides the user to the Solution component and, when a
// solution project already exists in the workspace, best-effort wires the reference
// via `pac solution add-reference --path <pcfComponentRoot>` (a local, auth-free op).
// Deeper solution integration is a fast-follow — `pac pcf push` remains the one-click
// inner loop.
/** Solution component type for a PCF control (`customcontrol`). Web resources are 61, plug-in steps 92. */
export const CUSTOM_CONTROL_COMPONENT_TYPE = 66;

// How a customcontrol's name is stored (publisher-prefixed) lives in rowLookups.ts, so the product and
// the e2e client share ONE definition — they each had their own copy of the wrong one, agreed with each
// other, and both reported a successful push as "not in the environment" (#143 Move 3).
export { customControlLookup } from "../general/dataverse/rowLookups";

/** The `customcontrol` row id for a pushed control, or undefined when it is not in the environment. */
async function findCustomControlId(context: DataversePowerToolsContext, controlName: string): Promise<string | undefined> {
  // Initialise the connection if it is not live yet — the same readiness check the solution helper does.
  if (!context.dataverse?.isValid && !(await context.dataverse?.initialize())) {
    return undefined;
  }
  if (!context.dataverse.organizationUrl) {
    return undefined;
  }
  try {
    const lookup = customControlLookup(controlName);
    const response = await fetch(dataverseApiUrl(context.dataverse.organizationUrl, lookup.resource), {
      method: "GET",
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      headers: { Authorization: "Bearer " + (await context.dataverse.getAuthorizationToken()), "Content-Type": "application/json" },
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, `find PCF control '${controlName}'`, response);
      return undefined;
    }
    const data: any = await response.json();
    const row = pickMatchingRow<{ name?: string; customcontrolid?: string }>(data?.value, lookup, "name");
    return row?.customcontrolid;
  } catch (error) {
    logDataverseError(context.channel, `find PCF control '${controlName}'`, error);
    return undefined;
  }
}

/** `<namespace>.<constructor>` from a ControlManifest — the name the `customcontrol` row carries. */
export function controlNameFromManifest(manifestXml: string): string | undefined {
  const namespaceName = /namespace="([^"]+)"/.exec(manifestXml ?? "")?.[1];
  const constructorName = /constructor="([^"]+)"/.exec(manifestXml ?? "")?.[1];
  return namespaceName && constructorName ? `${namespaceName}.${constructorName}` : undefined;
}

/**
 * Put the PUSHED control into the solution configured for this component, the same way a web resource
 * or a plug-in step is added: resolve the row, then AddSolutionComponent. Returns false (quietly, with
 * a reason in the log) when there is nothing to add yet.
 */
async function addControlToConfiguredSolution(context: DataversePowerToolsContext, componentRoot: string): Promise<boolean> {
  const solutionUniqueName = context.projectSettings.solutionName;
  if (!solutionUniqueName) {
    context.channel.appendLine("No solution is configured for this component — set one in the connection settings.");
    return false;
  }

  const controlDir = findControlDir(componentRoot);
  const manifestPath = controlDir ? path.join(controlDir, CONTROL_MANIFEST_FILENAME) : undefined;
  const controlName = manifestPath ? controlNameFromManifest(fs.readFileSync(manifestPath, "utf8")) : undefined;
  if (!controlName) {
    context.channel.appendLine("Could not read the control's namespace/constructor from ControlManifest.Input.xml.");
    return false;
  }

  const controlId = await findCustomControlId(context, controlName);
  if (!controlId) {
    context.channel.appendLine(`'${controlName}' is not in the environment yet, so there is nothing to add to '${solutionUniqueName}'.`);
    return false;
  }

  const associated = await addDataverseSolutionComponent(context, solutionUniqueName, CUSTOM_CONTROL_COMPONENT_TYPE, controlId);
  if (associated) {
    context.channel.appendLine(`Added PCF control '${controlName}' to solution '${solutionUniqueName}'.`);
    vscode.window.showInformationMessage(`Added '${controlName}' to solution '${solutionUniqueName}'.`);
  } else {
    context.reportFailure(`Could not add '${controlName}' to solution '${solutionUniqueName}'.`);
  }
  return associated;
}

export async function deployPcf(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  // Add the control to the solution you already chose, exactly like a web resource or a plug-in step:
  // resolve the pushed customcontrol row and POST AddSolutionComponent. Requiring a whole Solution
  // PROJECT for this was PCF-only and surprising — no other component type asks for one (#256).
  const added = await addControlToConfiguredSolution(context, componentRoot);

  const solutionDir = findSolutionProjectDir();
  if (!solutionDir) {
    if (!added) {
      // Nothing to add, and no project to reference: the missing step is almost always the push, so say
      // that rather than sending people off to create a Solution component.
      context.channel.appendLine("Push the control first — Add to Solution puts the control that is IN the environment into your solution.");
      vscode.window.showWarningMessage("Push the PCF control first, then Add to Solution.");
    }
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    `Add this PCF control as a reference to the solution project in ${path.basename(solutionDir)}?`,
    "Add reference",
    "Cancel",
  );
  if (confirm !== "Add reference") {
    return;
  }

  try {
    // `pac solution add-reference` runs inside the cdsproj folder and records a
    // reference to the pcfproj — no Dataverse auth required.
    const { stdout, stderr } = await runPac(["solution", "add-reference", "--path", componentRoot], solutionDir);
    if (stdout) {
      context.channel.appendLine(stdout);
    }
    if (stderr) {
      context.channel.appendLine(stderr);
    }
    context.channel.appendLine("PCF control added as a solution reference. Deploy the solution to push it to the environment.");
    vscode.window.showInformationMessage("PCF control added to the solution. Deploy the solution to publish it.");
  } catch (error: any) {
    if (error?.stdout) {
      context.channel.appendLine(error.stdout);
    }
    if (error?.stderr) {
      context.channel.appendLine(error.stderr);
    }
    context.channel.appendLine(`Error running pac solution add-reference: ${error?.error?.message || error?.message || "Unknown error"}`);
    context.channel.show();
    vscode.window.showErrorMessage("Could not add the PCF control to the solution. See output for details.");
  }
}
