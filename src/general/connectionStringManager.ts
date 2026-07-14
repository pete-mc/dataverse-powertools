import { window, workspace } from "vscode";
import DataversePowerToolsContext from "../context";
import { clearInteractiveTokenCache } from "./dataverse/tokenAcquisition";
import { runPacResult } from "./pacAuth";
import { projectTypeRegistry, getProjectTypeDescriptor } from "../projectTypes/registry";
import { MultiStepInput, shouldResume, validationIgnore } from "./inputControls";
import { getSolutions } from "./dataverse/getSolutions";
import { DataverseAuthType, parseAuthType } from "./dataverse/authTypes";
import { buildAuthConnectionString, getOrganizationUrl, normalizeOrganizationUrl, parseConnectionString } from "./connectionString";
import { discoverEnvironments, discoverEnvironmentsWithSecret } from "./dataverse/globalDiscovery";

export async function updateConnectionString(context: DataversePowerToolsContext) {
  let connectionString = await createServicePrincipalString(context, true);
  await context.writeSettings();
  await context.readSettings();
  // Auth/environment changed on the root — refresh what sub-components inherit.
  await propagateEnvironmentToComponents(context);
  // Parse the url by name rather than a fixed segment index — the segment order
  // differs across auth types (OAuth strings have no LoginPrompt).
  context.setStatusBar(getOrganizationUrl(connectionString));
  context.refreshPanel?.();
}

/**
 * Switch to a different Dataverse environment without re-entering credentials. Reuses
 * the current connection's auth (interactive signs in silently from the cached account;
 * client secret reuses the stored secret), lists environments via Global Discovery,
 * then updates the connection url + solution for the chosen environment.
 */
export async function switchEnvironment(context: DataversePowerToolsContext): Promise<void> {
  const parts = parseConnectionString(context.connectionString || context.projectSettings.connectionString || "");
  const authType = parseAuthType(parts.authType);
  const tenantId = context.projectSettings.tenantId || parts.tenantId || "";

  let environments: Awaited<ReturnType<typeof discoverEnvironments>>;
  if (authType === DataverseAuthType.oauth) {
    environments = await discoverEnvironments(parts.clientId);
  } else if (parts.clientId && parts.clientSecret) {
    environments = await discoverEnvironmentsWithSecret(parts.clientId, parts.clientSecret, tenantId);
  }

  if (!environments || environments.length === 0) {
    window.showErrorMessage("No Dataverse environments were found to switch to. Try Update Dataverse Authentication.");
    return;
  }
  const pick = await window.showQuickPick(
    environments.map((environment) => ({ label: environment.friendlyName, description: environment.url, target: environment })),
    { placeHolder: "Switch to which Dataverse environment?", ignoreFocusOut: true },
  );
  if (!pick) {
    return;
  }
  const newUrl = normalizeOrganizationUrl(pick.target.url);
  // The environment GUID addresses the Admin Center / Maker Portal links; the old
  // one must never survive a switch, so overwrite even when discovery has none.
  context.projectSettings.environmentId = pick.target.environmentId;

  let connectionString: string;
  if (authType === DataverseAuthType.oauth) {
    connectionString = buildAuthConnectionString({ authType: "OAuth", url: newUrl, clientId: parts.clientId });
  } else {
    connectionString = buildAuthConnectionString({ authType: "ClientSecret", url: newUrl, clientId: parts.clientId, clientSecret: parts.clientSecret });
    // Persist the secret under the new org so readSettings can rehydrate it (the
    // persisted connection string has the secret stripped out).
    if (parts.clientId && parts.clientSecret) {
      await saveServicePrincipalString(context, newUrl, parts.clientId, parts.clientSecret, tenantId);
    }
  }
  context.connectionString = connectionString;
  context.projectSettings.connectionString = connectionString;
  context.projectSettings.tenantId = tenantId;

  // Drop the cached token — it's for the old org — so the next call re-authenticates
  // against the new environment (interactive stays silent via the cached account).
  context.dataverse.authorizationToken = "";
  context.dataverse.tenantId = tenantId;

  const solutions = await getSolutions(context);
  if (solutions && solutions.length > 0) {
    const solutionPick = await window.showQuickPick(
      solutions.map((solution) => ({ label: solution.displayName, target: solution })),
      { placeHolder: "Select a solution in the new environment" },
    );
    if (solutionPick) {
      context.projectSettings.solutionName = solutionPick.target.uniqueName;
      context.projectSettings.webresourceSolutionName = solutionPick.target.uniqueName;
      context.projectSettings.prefix = solutionPick.target.publisherPrefix;
    }
  }

  await context.writeSettings();
  await context.readSettings();
  // One environment per workspace: sub-components inherit the root connection at
  // discovery time, and their own solution binding pointed at the OLD environment —
  // update both so the switch really applies everywhere, not just the root card.
  await propagateEnvironmentToComponents(context);
  context.setStatusBar(getOrganizationUrl(connectionString));
  // Re-render the panel so the environment + solution reflect the switch
  // immediately — previously stale until a reload (#102).
  context.refreshPanel?.();
  window.showInformationMessage(`Switched to ${pick.label}`);
}

/** After an environment (or auth) change on the root: rewrite each sub-component's
 * solution binding to the newly picked solution (its old one lived in the previous
 * environment) and re-discover so inherited connection fields refresh. Components
 * with their own connectionString are self-contained and left alone. */
async function propagateEnvironmentToComponents(context: DataversePowerToolsContext): Promise<void> {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  for (const component of context.components ?? []) {
    if (component.isRoot) {
      continue;
    }
    const settingsPath = path.join(component.root, "dataverse-powertools.json");
    try {
      const raw = JSON.parse(await fs.promises.readFile(settingsPath, "utf8"));
      if (raw.connectionString) {
        continue; // self-contained component with its own environment
      }
      if (context.projectSettings.solutionName) {
        raw.solutionName = context.projectSettings.solutionName;
        if (raw.webresourceSolutionName !== undefined) {
          raw.webresourceSolutionName = context.projectSettings.solutionName;
        }
      }
      await fs.promises.writeFile(settingsPath, JSON.stringify(raw, null, 2));
    } catch {
      context.channel.appendLine(`Could not update ${settingsPath} for the environment switch.`);
    }
  }
  const { discoverWorkspaceComponents } = await import("../components/componentDiscovery");
  await discoverWorkspaceComponents(context);
}

/**
 * Re-establish the Dataverse connection using the saved credentials — for when the
 * silent connect on load didn't happen, the token has gone stale, or VS Code has been
 * open a long time. Rehydrates the connection from settings and re-authenticates
 * (interactive prompts a sign-in only if the cached token can't be renewed silently).
 */
export async function refreshConnection(context: DataversePowerToolsContext): Promise<void> {
  await context.readSettings();
  if (!context.connectionString) {
    window.showErrorMessage("No Dataverse connection is configured. Run Update Dataverse Authentication first.");
    return;
  }
  context.dataverse.authorizationToken = "";
  const connected = await context.dataverse.initialize(true);
  if (connected) {
    context.setStatusBar(getOrganizationUrl(context.connectionString));
    window.showInformationMessage("Reconnected to Dataverse.");
  } else {
    window.showErrorMessage("Could not reconnect to Dataverse. See the output for details.");
    context.channel.show();
  }
}

export async function getServicePrincipalString(context: DataversePowerToolsContext, name: string): Promise<string> {
  const servicePrincipal = await context.vscode.secrets.get(name);
  return servicePrincipal === undefined ? "" : servicePrincipal.split("TenantID=")[0];
}

// SecretStorage can't enumerate keys, so every stored service-principal key is
// tracked in globalState — that's what lets Clear Stored Credentials find them.
const SECRET_KEY_INDEX = "dataverse-powertools.storedSecretKeys";

export async function saveServicePrincipalString(context: DataversePowerToolsContext, name: string, clientId: string, clientSecret: string, tenantId: string): Promise<void> {
  const value = "ClientId=" + clientId + ";" + "ClientSecret=" + clientSecret + ";" + "TenantID=" + tenantId + ";";
  name = name.replace(/\/+$/, "");
  await context.vscode.secrets.store(name, value);
  const index = context.vscode.globalState.get<string[]>(SECRET_KEY_INDEX, []);
  if (!index.includes(name)) {
    await context.vscode.globalState.update(SECRET_KEY_INDEX, [...index, name]);
  }
  context.channel.appendLine("Settings Saved!");
}

/** Sign out everywhere: delete every tracked service-principal secret, the MSAL
 * token cache, and (best-effort) pac's auth profiles. Registered as
 * "Clear Stored Credentials" — also used by the e2e suites so one auth type's
 * leftovers can't mask issues in the other (found via the no-environment bug). */
export async function clearStoredCredentials(context: DataversePowerToolsContext): Promise<void> {
  const index = context.vscode.globalState.get<string[]>(SECRET_KEY_INDEX, []);
  for (const key of index) {
    try {
      await context.vscode.secrets.delete(key);
    } catch {
      /* already gone */
    }
  }
  await context.vscode.globalState.update(SECRET_KEY_INDEX, []);
  await clearInteractiveTokenCache();
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const pacCleared = await runPacResult(["auth", "clear"], workspaceRoot);
  context.channel.appendLine(
    `Cleared stored credentials: ${index.length} service-principal secret(s), the interactive token cache${pacCleared.code === 0 ? ", and all pac auth profiles" : " (pac auth clear failed — see pac output)"}.`,
  );
  context.dataverse.authorizationToken = "";
  context.refreshPanel?.();
  window.showInformationMessage("Dataverse PowerTools credentials cleared. Reconnect via Update Dataverse Authentication.");
}

export async function createServicePrincipalString(context: DataversePowerToolsContext, _update: boolean = false): Promise<string> {
  const title = "Creating the Credentials";
  const state = await collectInputs();
  const authType = state.authType ?? DataverseAuthType.clientSecret;
  let connectionString: string;
  if (authType === DataverseAuthType.oauth) {
    connectionString = buildAuthConnectionString({ authType: "OAuth", url: state.organisationUrl, clientId: state.applicationId });
    context.connectionString = connectionString;
  } else {
    connectionString = "AuthType=ClientSecret;LoginPrompt=Never;Url=";
    connectionString += state.organisationUrl + ";";
    context.connectionString = connectionString;
    if (state.saveCredential) {
      await saveServicePrincipalString(context, state.organisationUrl, state.applicationId, state.clientSecret, state.tenantId);
      connectionString += "ClientId=";
      connectionString += state.applicationId += ";ClientSecret=";
      connectionString += state.clientSecret;
    } else {
      connectionString += await getServicePrincipalString(context, state.organisationUrl);
    }
  }
  context.projectSettings.prefix = state.prefix;
  context.projectSettings.tenantId = state.tenantId;
  // Cleared on a manual-url entry: an environmentId from a previous connection
  // would point the Admin Center / Maker Portal links at the wrong environment.
  context.projectSettings.environmentId = state.environmentId;
  context.projectSettings.solutionName = state.solutionName;
  context.projectSettings.webresourceSolutionName = state.solutionName;
  context.projectSettings.connectionString = connectionString;
  return connectionString;

  async function collectInputs() {
    const state = {} as Partial<State>;
    await MultiStepInput.run((input) => inputAuthType(input, state));
    return state as State;
  }

  async function inputAuthType(input: MultiStepInput, state: Partial<State>) {
    const pick = (await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 7,
      placeholder: "Select the authentication type",
      items: [
        { label: "OAuth", target: DataverseAuthType.oauth },
        { label: "Service principal (client secret)", target: DataverseAuthType.clientSecret },
      ],
      shouldResume: shouldResume,
    })) as any;
    state.authType = pick?.target ?? DataverseAuthType.clientSecret;
    // Both flows discover the environment; interactive signs in first, client secret
    // collects tenant + app id + secret first.
    if (state.authType === DataverseAuthType.oauth) {
      return (input: MultiStepInput) => inputEnvironment(input, state);
    }
    return (input: MultiStepInput) => inputTenantId(input, state);
  }

  async function inputEnvironment(_input: MultiStepInput, state: Partial<State>) {
    // List environments via Global Discovery (interactive signs in; client secret uses
    // its app token) so the user picks one instead of typing an org url. App-only
    // discovery only sees environments where the app is an application user, so fall
    // back to manual url entry when nothing comes back.
    const environments =
      state.authType === DataverseAuthType.oauth
        ? await discoverEnvironments()
        : await discoverEnvironmentsWithSecret(state.applicationId ?? "", state.clientSecret ?? "", state.tenantId ?? "");
    if (!environments || environments.length === 0) {
      context.channel.appendLine("No environments returned from Global Discovery; enter the organisation URL manually.");
      return (input: MultiStepInput) => inputManualUrl(input, state);
    }
    const pick = await window.showQuickPick(
      environments.map((environment) => ({ label: environment.friendlyName, description: environment.url, target: environment })),
      { placeHolder: "Select a Dataverse environment", ignoreFocusOut: true },
    );
    if (!pick) {
      return (input: MultiStepInput) => inputManualUrl(input, state);
    }
    state.organisationUrl = normalizeOrganizationUrl(pick.target.url);
    state.environmentId = pick.target.environmentId;
    return (input: MultiStepInput) => inputSolutionName(input, state);
  }

  async function inputManualUrl(input: MultiStepInput, state: Partial<State>) {
    const url = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 2,
      totalSteps: 7,
      value: state.organisationUrl || "",
      prompt: "Type in the Organisation URL",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    state.organisationUrl = normalizeOrganizationUrl(url);
    return (input: MultiStepInput) => inputSolutionName(input, state);
  }

  async function inputTenantId(input: MultiStepInput, state: Partial<State>) {
    state.tenantId = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 2,
      totalSteps: 6,
      value: typeof state.tenantId === "string" ? state.tenantId.replace(/\/+$/, "") : "",
      prompt: "Type in the Tenant Id",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    context.dataverse.tenantId = state.tenantId;
    return (input: MultiStepInput) => inputApplicationId(input, state);
  }

  async function inputApplicationId(input: MultiStepInput, state: Partial<State>) {
    state.saveCredential = true;
    state.applicationId = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 4,
      totalSteps: 7,
      value: state.applicationId || "",
      prompt: "Type in the Application ID",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    return (input: MultiStepInput) => inputClientSecret(input, state);
  }

  async function inputClientSecret(input: MultiStepInput, state: Partial<State>) {
    state.clientSecret = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 5,
      totalSteps: 7,
      value: state.clientSecret || "",
      prompt: "Type in the Client Secret",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    // Client secret discovers its environment after collecting credentials.
    return (input: MultiStepInput) => inputEnvironment(input, state);
  }

  async function inputSolutionName(_input: MultiStepInput, state: Partial<State>) {
    state.solutionName = undefined;
    if (state.organisationUrl === undefined) {
      return (input: MultiStepInput) => inputManualSolutionName(input, state);
    }
    // Set up a live connection so we can list solutions. For interactive this is all
    // that's needed — getSolutions -> initialize triggers the browser sign-in here.
    if (state.authType === DataverseAuthType.oauth) {
      context.connectionString = buildAuthConnectionString({ authType: "OAuth", url: state.organisationUrl, clientId: state.applicationId });
    } else {
      if (state.applicationId === undefined || state.clientSecret === undefined) {
        return (input: MultiStepInput) => inputManualSolutionName(input, state);
      }
      context.connectionString = `AuthType=ClientSecret;LoginPrompt=Never;Url=${state.organisationUrl};ClientId=${state.applicationId};ClientSecret=${state.clientSecret}`;
    }
    context.projectSettings.tenantId = state.tenantId;
    const solutions = await getSolutions(context);
    if (!solutions) {
      return (input: MultiStepInput) => inputManualSolutionName(input, state);
    }
    const quickPickArray = solutions.map((solution) => ({ label: solution.displayName, target: solution }));
    const result = await window.showQuickPick(quickPickArray, { placeHolder: "Select a CRM/Dynamics Solution." });
    // Infer the publisher prefix from the chosen solution so we don't have to ask.
    state.solutionName = result?.target.uniqueName;
    state.prefix = result?.target.publisherPrefix;
    window.showInformationMessage(`Solution Selected: ${result?.label}`);
    if (state.solutionName === undefined) {
      return (input: MultiStepInput) => inputManualSolutionName(input, state);
    }
    return;
  }

  async function inputManualSolutionName(input: MultiStepInput, state: Partial<State>) {
    state.solutionName = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 5,
      totalSteps: 6,
      value: state.solutionName || "",
      prompt: "What is the schema name of the solution?",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    return (input: MultiStepInput) => inputPrefix(input, state);
  }

  async function inputPrefix(input: MultiStepInput, state: Partial<State>) {
    if (state.prefix === null || state.prefix === "" || state.prefix === undefined) {
      state.prefix = await input.showInputBox({
        ignoreFocusOut: true,
        title,
        step: 6,
        totalSteps: 6,
        value: state.prefix || "",
        prompt: "What is the solution prefix?",
        validate: validationIgnore,
        shouldResume: shouldResume,
      });
    }
  }
}

export type ProjectTypePick = "cancelled" | "empty" | "selected";

export async function getProjectType(context: DataversePowerToolsContext): Promise<ProjectTypePick> {
  const result = await window.showQuickPick(
    [
      // The multi-component container floated to the top (#156): a connection-only root
      // with each component in its own subfolder — the recommended layout for anything
      // beyond a single project. `target: undefined` keeps the connection-only-root semantics.
      { label: "Multi-component project (two or more types)", description: "one connection-only root; each component in its own subfolder", target: undefined },
      ...projectTypeRegistry.map((d) => ({ label: d.displayName, description: d.displayName, target: d.id as string | undefined })),
    ],
    { placeHolder: "Select a Project Type." },
  );
  if (!result) {
    return "cancelled";
  }
  context.projectSettings.type = result.target as typeof context.projectSettings.type;
  context.projectSettings.templateversion = getProjectTypeDescriptor(result.target)?.defaultTemplateVersion ?? 1;
  // Fresh scaffolds carry the CURRENT config revision (#113) — only genuinely
  // older projects read as stale.
  context.projectSettings.configRevision = getProjectTypeDescriptor(result.target)?.configRevision;
  context.channel.appendLine(`Project Type: ${result.label}`);
  return result.target ? "selected" : "empty";
}

export async function getSolutionName(context: DataversePowerToolsContext) {
  const result = await window.showInputBox({
    ignoreFocusOut: true,
    prompt: "Type in the Solution Name",
  });
  context.projectSettings.solutionName = result;
  window.showInformationMessage(`Solution: ${result}`);
}

interface State {
  title: string;
  step: number;
  authType: DataverseAuthType;
  organisationUrl: string;
  environmentId?: string;
  tenantId: string;
  applicationId: string;
  totalSteps: number;
  name: string;
  clientSecret: string;
  solutionName: string;
  prefix: string;
  saveCredential: boolean;
}
