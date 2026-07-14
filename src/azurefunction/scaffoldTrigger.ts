import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { AZURE_FUNCTION_TRIGGERS, AzureFunctionTrigger, DEFAULT_AZURE_FUNCTION_TRIGGER, triggerFileName, triggerTemplatePath } from "./triggers";

// A function component isn't necessarily a Dataverse webhook (#145): it may just as well be a
// plain HTTP API, a scheduled timer, or a Service Bus consumer. The sample handler is therefore
// NOT in template.json's file list — the trigger is picked at scaffold time and only the chosen
// sample is written. The trigger is remembered in settings so the panel can lead with the right
// action (Register Webhook & Step only leads for the HTTP webhook).

/** Ask which trigger to scaffold and write that sample handler into the component.
 * Best-effort: a dismissed pick falls back to the Dataverse webhook. */
export async function promptAndScaffoldTrigger(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    return;
  }

  const pick = await vscode.window.showQuickPick(
    AZURE_FUNCTION_TRIGGERS.map((trigger) => ({ label: trigger.label, description: trigger.description, target: trigger.id })),
    { placeHolder: "How is this Azure Function triggered?", ignoreFocusOut: true },
  );
  const trigger: AzureFunctionTrigger = pick?.target ?? DEFAULT_AZURE_FUNCTION_TRIGGER;

  context.projectSettings.azureFunctionTrigger = trigger;
  await context.writeSettings();

  await writeTriggerSample(context, componentRoot, trigger);
}

/** Copy the trigger's sample handler template into the component (never overwrites). */
export async function writeTriggerSample(context: DataversePowerToolsContext, componentRoot: string, trigger: AzureFunctionTrigger): Promise<void> {
  const destination = path.join(componentRoot, triggerFileName(trigger));
  if (fs.existsSync(destination)) {
    return;
  }

  try {
    const templatePath = context.vscode.asAbsolutePath(path.join(...triggerTemplatePath(trigger)));
    const contents = await fs.promises.readFile(templatePath, "utf8");
    await vscode.workspace.fs.writeFile(vscode.Uri.file(destination), Buffer.from(contents, "utf8"));
    context.channel.appendLine(`Created ${triggerFileName(trigger)} (${trigger} trigger).`);
  } catch (error) {
    context.channel.appendLine(`Could not write the ${trigger} sample handler: ${error}`);
  }
}
