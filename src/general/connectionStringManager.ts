import { window } from "vscode";
import DataversePowerToolsContext, { ProjectTypes } from "../context";
import { MultiStepInput, shouldResume, validationIgnore } from "./inputControls";
import { getSolutions } from "./dataverse/getSolutions";
import { DataverseAuthType } from "./dataverse/authTypes";
import { buildAuthConnectionString, getOrganizationUrl, normalizeOrganizationUrl } from "./connectionString";
import { discoverEnvironments } from "./dataverse/globalDiscovery";

export async function updateConnectionString(context: DataversePowerToolsContext) {
  let connectionString = await createServicePrincipalString(context, true);
  await context.writeSettings();
  await context.readSettings();
  // Parse the url by name rather than a fixed segment index — the segment order
  // differs across auth types (OAuth strings have no LoginPrompt).
  context.statusBar.text = getOrganizationUrl(connectionString);
  context.statusBar.show();
}

export async function getServicePrincipalString(context: DataversePowerToolsContext, name: string): Promise<string> {
  const servicePrincipal = await context.vscode.secrets.get(name);
  return servicePrincipal === undefined ? "" : servicePrincipal.split("TenantID=")[0];
}

export async function saveServicePrincipalString(context: DataversePowerToolsContext, name: string, clientId: string, clientSecret: string, tenantId: string): Promise<void> {
  const value = "ClientId=" + clientId + ";" + "ClientSecret=" + clientSecret + ";" + "TenantID=" + tenantId + ";";
  name = name.replace(/\/+$/, "");
  await context.vscode.secrets.store(name, value);
  context.channel.appendLine("Settings Saved!");
}

export async function createServicePrincipalString(context: DataversePowerToolsContext, update: boolean = false): Promise<string> {
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
        { label: "Interactive sign-in", target: DataverseAuthType.oauth },
        { label: "Service principal (client secret)", target: DataverseAuthType.clientSecret },
      ],
      shouldResume: shouldResume,
    })) as any;
    state.authType = pick?.target ?? DataverseAuthType.clientSecret;
    // Interactive skips typing an org url — sign in and pick an environment instead.
    if (state.authType === DataverseAuthType.oauth) {
      return (input: MultiStepInput) => inputEnvironment(input, state);
    }
    return (input: MultiStepInput) => inputURL(input, state);
  }

  async function inputEnvironment(_input: MultiStepInput, state: Partial<State>) {
    // Sign in interactively and list environments via Global Discovery so the user
    // picks one instead of typing an org url. Fall back to manual url entry on failure.
    const environments = await discoverEnvironments();
    if (!environments || environments.length === 0) {
      context.channel.appendLine("Global Discovery returned no environments; falling back to manual entry.");
      return (input: MultiStepInput) => inputURL(input, state);
    }
    const pick = await window.showQuickPick(
      environments.map((environment) => ({ label: environment.friendlyName, description: environment.url, target: environment })),
      { placeHolder: "Select a Dataverse environment", ignoreFocusOut: true },
    );
    if (!pick) {
      return (input: MultiStepInput) => inputURL(input, state);
    }
    state.organisationUrl = normalizeOrganizationUrl(pick.target.url);
    return (input: MultiStepInput) => inputSolutionName(input, state);
  }

  async function inputURL(input: MultiStepInput, state: Partial<State>) {
    state.organisationUrl = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 1,
      totalSteps: 6,
      value: typeof state.organisationUrl === "string" ? state.organisationUrl.replace(/\/+$/, "") : "",
      prompt: "Type in the Organisation URl",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    // The "reuse existing credentials" shortcut only applies to stored client
    // secrets; interactive connections gather their own inputs.
    if (update || state.authType !== DataverseAuthType.clientSecret) {
      return (input: MultiStepInput) => inputTenantId(input, state);
    }
    let organisationUrl = "";
    if (state.organisationUrl !== undefined && state.organisationUrl !== "") {
      organisationUrl = state.organisationUrl.replace(/\/+$/, "");
    }
    const credentialResult = await context.vscode.secrets.get(organisationUrl);
    const splitCreds = credentialResult?.split(";");
    if (credentialResult === undefined || splitCreds === undefined || splitCreds.length < 4) {
      return (input: MultiStepInput) => inputTenantId(input, state);
    }
    const result = await window.showQuickPick(["Yes", "No"], { placeHolder: "Existing credentials found. Do you want to use the existing credentials?" });
    if (result === "No") {
      return (input: MultiStepInput) => inputTenantId(input, state);
    }
    state.applicationId = splitCreds[0].replace("ClientId=", "");
    state.clientSecret = splitCreds[1].replace("ClientSecret=", "");
    state.tenantId = splitCreds[2].replace("TenantID=", "");
    context.dataverse.tenantId = state.tenantId;
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
    // Interactive uses the built-in Dataverse sign-in app (same id as XrmToolBox),
    // so there's no application id to collect — go straight to picking a solution.
    if (state.authType === DataverseAuthType.oauth) {
      return (input: MultiStepInput) => inputSolutionName(input, state);
    }
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
    return update ? undefined : (input: MultiStepInput) => inputSolutionName(input, state);
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

export async function getProjectType(context: DataversePowerToolsContext) {
  const result = await window.showQuickPick(
    [
      { label: "Plugins", description: "Plugins", target: ProjectTypes.plugin },
      { label: "Web Resources", description: "Web Resources", target: ProjectTypes.webresource },
      { label: "Solution", description: "Solution", target: ProjectTypes.solution },
      { label: "Portal", description: "Portal", target: ProjectTypes.portal },
    ],
    { placeHolder: "Select a Project Type." },
  );
  context.projectSettings.type = result?.target;
  switch (context.projectSettings.type) {
    case ProjectTypes.plugin:
      context.projectSettings.templateversion = 3;
      break;
    case ProjectTypes.solution:
      context.projectSettings.templateversion = 1.1;
      break;
    default:
      context.projectSettings.templateversion = 1;
      break;
  }
  context.channel.appendLine(`Project Type: ${result?.label}`);
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
  tenantId: string;
  applicationId: string;
  totalSteps: number;
  name: string;
  clientSecret: string;
  solutionName: string;
  prefix: string;
  saveCredential: boolean;
}
