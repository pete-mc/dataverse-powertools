import { window } from "vscode";
import DataversePowerToolsContext, { ProjectTypes } from "../context";
import { MultiStepInput, shouldResume, validationIgnore } from "./inputControls";
import { getSolutions } from "./dataverse/getSolutions";

export async function updateConnectionString(context: DataversePowerToolsContext) {
  let connectionString = await createServicePrincipalString(context, true);
  await context.writeSettings();
  await context.readSettings();
  context.statusBar.text = connectionString.split(";")[2].replace("Url=", "") ?? "";
  context.statusBar.show();
}

export async function getServicePrincipalString(context: DataversePowerToolsContext, name: string): Promise<string> {
  const servicePrincipal = await context.vscode.secrets.get(name);
  return servicePrincipal === undefined ? "" : servicePrincipal.split('TenantID=')[0];
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
  let connectionString = "AuthType=ClientSecret;LoginPrompt=Never;Url=";
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
  context.projectSettings.prefix = state.prefix;
  context.projectSettings.tenantId = state.tenantId;
  context.projectSettings.solutionName = state.solutionName;
  context.projectSettings.connectionString = connectionString;
  return connectionString;

  async function collectInputs() {
    const state = {} as Partial<State>;
    await MultiStepInput.run((input) => inputURL(input, state));
    return state as State;
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
    if (update) return (input: MultiStepInput) => inputTenantId(input, state);
    let organisationUrl = "";
    if (state.organisationUrl !== undefined && state.organisationUrl !== "") {
      organisationUrl = state.organisationUrl.replace(/\/+$/, "");
    }
    const credentialResult = await context.vscode.secrets.get(organisationUrl);
    const splitCreds = credentialResult?.split(";")
    if (credentialResult == undefined || splitCreds == undefined || splitCreds.length < 4) return (input: MultiStepInput) => inputTenantId(input, state);
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
      return (input: MultiStepInput) => inputApplicationId(input, state);
  }

  async function inputApplicationId(input: MultiStepInput, state: Partial<State>) {
    state.saveCredential = true;
    state.applicationId = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 3,
      totalSteps: 6,
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
      step: 4,
      totalSteps: 6,
      value: state.clientSecret || "",
      prompt: "Type in the Client Secret",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    return update ? undefined : (input: MultiStepInput) => inputSolutionName(input, state);
  }

  async function inputSolutionName(_input: MultiStepInput, state: Partial<State>) {
    state.solutionName = undefined;
    if (state.organisationUrl === undefined || state.tenantId === undefined || state.applicationId === undefined || state.clientSecret === undefined) {
      return (input: MultiStepInput) => inputManualSolutionName(input, state);
    }
    context.connectionString = `AuthType=ClientSecret;LoginPrompt=Never;Url=${state.organisationUrl};ClientId=${state.applicationId};ClientSecret=${state.clientSecret}`;
    context.projectSettings.tenantId = state.tenantId;
    const solutions = await getSolutions(context);
    if (!solutions) {
      return (input: MultiStepInput) => inputManualSolutionName(input, state);
    }
    let quickPickArray = [];
    for (const solution of solutions) {
      quickPickArray.push({ label: solution.displayName, target: solution });
    }
    const result = await window.showQuickPick(quickPickArray, { placeHolder: "Select a CRM/Dynamics Solution." });
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
      { label: "PCF Field", description: "PCF Field", target: ProjectTypes.pcffield },
      { label: "PCF Data Set", description: "PCF Data Set", target: ProjectTypes.pcfdataset },
      { label: "Solution", description: "Solution", target: ProjectTypes.solution },
      { label: "Portal", description: "Portal", target: ProjectTypes.portal },
    ],
    { placeHolder: "Select a Project Type." },
  );
  context.projectSettings.type = result?.target;
  switch (context.projectSettings.type) {
    case ProjectTypes.plugin:
      context.projectSettings.templateversion = 2;
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
