import * as vscode from "vscode";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { canCallDataverseApi } from "../general/dataverse/connectionReady";
import { DataverseContext } from "../general/dataverse/dataverseContext";
import { getDataverseMessages } from "../general/dataverse/getDataverseMessages";
import { getDataverseTables } from "../general/dataverse/getDataverseTables";
import { registerWebhookStep as registerStep, upsertWebhookServiceEndpoint } from "../general/dataverse/serviceEndpoints";
import { buildAuthValue, buildWebhookStepName, isValidWebhookUrl, StepMode, StepStage, WebhookAuthType } from "./webhookPayloads";

// "Register Webhook & Step" (#145 item 3): expose the function to Dataverse as a Webhook
// (serviceendpoint, contract = Webhook) and register the SDK message-processing step that
// fires it. Works under BOTH auth types — everything is gated on the LIVE CONNECTION
// (canCallDataverseApi), never on `tenantId` (interactive/OAuth sets none).
//
// The webhook key is a SECRET: it goes to VS Code secret storage and is sent to Dataverse in
// the (write-only) serviceendpoint.authvalue. It is NEVER written to dataverse-powertools.json.

const NO_TABLE = "(no primary table)";

/** Secret-storage key for a webhook key, scoped to the environment + endpoint name. */
export function webhookKeySecretName(organizationUrl: string | undefined, endpointName: string): string {
  return `dataverse-powertools.webhookKey:${(organizationUrl ?? "").replace(/\/+$/, "")}:${endpointName}`;
}

async function ensureConnection(context: DataversePowerToolsContext): Promise<boolean> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }
  if (!context.dataverse.isValid) {
    await context.dataverse.initialize();
  }
  if (!canCallDataverseApi({ organizationUrl: context.dataverse.organizationUrl, isValid: context.dataverse.isValid })) {
    vscode.window.showErrorMessage("Could not connect to Dataverse. Check the connection and try again.");
    context.channel.appendLine("[Webhook] No usable Dataverse connection — registration aborted.");
    return false;
  }
  return true;
}

export async function registerWebhookStep(context: DataversePowerToolsContext): Promise<void> {
  if (!(await ensureConnection(context))) {
    return;
  }

  const componentRoot = activeComponentRoot(context);
  const defaultName = context.projectSettings.azureFunctionEndpointName || (componentRoot ? path.basename(componentRoot) : "AzureFunction");

  const endpointName = await vscode.window.showInputBox({
    title: "Register Webhook & Step (1/6)",
    prompt: "Name for the Dataverse webhook (service endpoint)",
    value: defaultName,
    ignoreFocusOut: true,
    validateInput: (value) => (value && value.trim().length > 0 ? undefined : "A webhook name is required."),
  });
  if (!endpointName) {
    return;
  }

  const functionUrl = await vscode.window.showInputBox({
    title: "Register Webhook & Step (2/6)",
    prompt: "The function's HTTPS endpoint URL (e.g. https://myapp.azurewebsites.net/api/OnAccountCreate)",
    value: context.projectSettings.azureFunctionUrl || "https://",
    ignoreFocusOut: true,
    validateInput: (value) => (isValidWebhookUrl(value) ? undefined : "Enter an absolute https:// URL."),
  });
  if (!functionUrl) {
    return;
  }

  const authPick = await vscode.window.showQuickPick(
    [
      { label: "Webhook Key", description: "Dataverse appends the key as ?code=<key> (Azure Functions host/function key)", value: WebhookAuthType.webhookKey },
      { label: "HTTP Header", description: "Dataverse sends the key as the x-functions-key header", value: WebhookAuthType.httpHeader },
    ],
    { title: "Register Webhook & Step (3/6)", placeHolder: "How should Dataverse authenticate to the function?", ignoreFocusOut: true },
  );
  if (!authPick) {
    return;
  }

  const secretName = webhookKeySecretName(context.dataverse.organizationUrl, endpointName.trim());
  const storedKey = await context.vscode.secrets.get(secretName);
  const webhookKey = await vscode.window.showInputBox({
    title: "Register Webhook & Step (4/6)",
    prompt: "Function key (stored in VS Code secret storage — never written to dataverse-powertools.json)",
    value: storedKey ?? "",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value && value.trim().length > 0 ? undefined : "A function key is required."),
  });
  if (!webhookKey) {
    return;
  }

  const messages = await getDataverseMessages(context);
  const messageName = await vscode.window.showQuickPick(messages.length > 0 ? messages : ["Create", "Update", "Delete"], {
    title: "Register Webhook & Step (5/6)",
    placeHolder: "Which message should trigger the function?",
    ignoreFocusOut: true,
  });
  if (!messageName) {
    return;
  }

  const tables = await getDataverseTables(context);
  const tablePick = await vscode.window.showQuickPick([NO_TABLE, ...tables], {
    title: "Register Webhook & Step (6/6)",
    placeHolder: "Primary table for the step (choose none for a table-less message)",
    ignoreFocusOut: true,
  });
  if (!tablePick) {
    return;
  }
  const entityLogicalName = tablePick === NO_TABLE ? undefined : tablePick;

  const stagePick = await vscode.window.showQuickPick(
    [
      { label: "Post-operation", description: "After the operation (stage 40) — the usual choice", value: StepStage.postOperation },
      { label: "Pre-operation", description: "Inside the transaction, before the operation (stage 20)", value: StepStage.preOperation },
      { label: "Pre-validation", description: "Before the transaction (stage 10)", value: StepStage.preValidation },
    ],
    { title: "Pipeline stage", placeHolder: "When should the webhook fire?", ignoreFocusOut: true },
  );
  if (!stagePick) {
    return;
  }

  const modePick = await vscode.window.showQuickPick(
    [
      { label: "Asynchronous", description: "Queued as a system job — recommended for an HTTP call-out", value: StepMode.asynchronous },
      { label: "Synchronous", description: "Blocks the operation; a failing function fails the user's transaction", value: StepMode.synchronous },
    ],
    { title: "Execution mode", placeHolder: "How should the webhook execute?", ignoreFocusOut: true },
  );
  if (!modePick) {
    return;
  }

  let filteringAttributes: string | undefined;
  if (messageName.toLowerCase() === "update" && entityLogicalName) {
    filteringAttributes = await vscode.window.showInputBox({
      title: "Filtering attributes",
      prompt: "Comma-separated columns that trigger the step (leave blank for all columns)",
      ignoreFocusOut: true,
    });
  }

  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Registering webhook and step in Dataverse..." }, async () => {
    // Secret first: the key never reaches the settings file, only secret storage and the
    // (write-only) serviceendpoint.authvalue.
    await context.vscode.secrets.store(secretName, webhookKey);

    const endpoint = await upsertWebhookServiceEndpoint(context, {
      name: endpointName.trim(),
      url: functionUrl.trim(),
      authType: authPick.value,
      authValue: buildAuthValue(authPick.value, webhookKey.trim()),
      description: "Registered by Dataverse PowerTools",
    });

    if (!endpoint.serviceEndpointId) {
      context.channel.show();
      vscode.window.showErrorMessage("Could not create the Dataverse webhook (service endpoint). See output for details.");
      return;
    }

    const stepName = buildWebhookStepName(endpointName.trim(), messageName, entityLogicalName);
    const result = await registerStep(context, endpoint.serviceEndpointId, {
      stepName,
      messageName,
      entityLogicalName,
      stage: stagePick.value,
      mode: modePick.value,
      filteringAttributes: filteringAttributes?.trim() || undefined,
      description: "Registered by Dataverse PowerTools",
    });

    if (result.error) {
      context.channel.appendLine(`[Webhook] ${result.error}`);
      context.channel.show();
      vscode.window.showErrorMessage(`Webhook registered, but the step was not: ${result.error}`);
      return;
    }

    // Non-secret bits only.
    context.projectSettings.azureFunctionEndpointName = endpointName.trim();
    context.projectSettings.azureFunctionUrl = functionUrl.trim();
    await context.writeSettings();

    const verb = result.created ? "Created" : "Updated";
    context.channel.appendLine(`[Webhook] ${verb} step '${stepName}' (${result.stepId}) against service endpoint ${endpoint.serviceEndpointId}.`);
    vscode.window.showInformationMessage(`${verb} webhook step '${stepName}'.`);
  });
}
