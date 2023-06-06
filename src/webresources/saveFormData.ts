import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { DataverseForm } from "../general/dataverse/DataverseForm";
import { randomUUID } from "crypto";

export async function saveFormData(context: DataversePowerToolsContext): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Registering form events...",
    },
    async () => {
      try {
        await saveFormDataExec(context);
        vscode.window.showInformationMessage("All events registered.");
      } catch {
        vscode.window.showErrorMessage("Error registering events.");
        context.channel.show();
      }
    },
  );
}

export async function saveFormDataExec(context: DataversePowerToolsContext): Promise<void> {
  context.channel.appendLine("Saving Forms...");

  const files = await vscode.workspace.findFiles("webresources_src/**/*.ts");
  const registerEvents: RegisterEvent[] = [];
  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file);
    const text = document.getText();
    const matches = text.matchAll(RegExp(`(?<=<PowerTools\\.RegisterEvent\\[]>).*?(?=;)`, "gs"));
    for (const match of matches) {
      JSON.parse(match[0].replace(/,(?=\s*[}\]])/g, "").replace(/(\w+)(?=:)/g, '"$1"')) as RegisterEvent[];
      registerEvents.push(...(JSON.parse(match[0].replace(/,(?=\s*[}\]])/g, "").replace(/(\w+)(?=:)/g, '"$1"')) as RegisterEvent[]));
    }
  }

  //Group the PowerTools.RegisterEvent objects by formId
  const groupedRegisterEvents = registerEvents.reduce((acc, cur) => {
    (acc[cur.formId] = acc[cur.formId] || []).push(cur);
    return acc;
  }, {} as { [key: string]: RegisterEvent[] });

  //get library filename from the project webpack.common.js
  const webpackConfig = await vscode.workspace.findFiles("webpack.common.js");
  const webpackConfigDocument = await vscode.workspace.openTextDocument(webpackConfig[0]);
  const webpackConfigText = webpackConfigDocument.getText();
  const libraryName = webpackConfigText.match(/(?<=output: {\s*filename: ['"]).*?(?=['"],)/)?.[0];

  for (const formId in groupedRegisterEvents) {
    const form = new DataverseForm(formId, context);
    await form.getFormData();
    /* eslint-disable @typescript-eslint/naming-convention */
    if (!form.form.form.formLibraries) {
      form.form.form.formLibraries = { Library: [] };
    }
    if (!form.form.form.formLibraries.Library.find((l: any) => l["@_name"] === libraryName)) {
      form.form.form.formLibraries.Library.push({
        "@_name": libraryName,
        "@_libraryUniqueId": "{" + randomUUID() + "}", //create a random guid
      });
    }
    //loop through the groupedRegisterEvents and add the events to the form
    for (const registerEvent of groupedRegisterEvents[formId]) {
      // look through the form for the event or add it if it doesn't exist
      if (!form.form.form.events) {
        form.form.form.events = { event: [] };
      }
      const event = form.form.form.events.event.find((e: any) => e["@_name"] === registerEvent.event);

      if (!event) {
        form.form.form.events.event.push({
          "@_name": registerEvent.event,
          "@_active": "true",
          "@_application": "true",
          Handlers: {
            Handler: [
              {
                "@_enabled": "true",
                "@_functionName": registerEvent.function,
                "@_libraryName": libraryName,
                "@_parameters": registerEvent.parameters ?? "",
                "@_passExecutionContext": registerEvent.executionContext ? "true" : "false",
                "@_handlerUniqueId": "{" + registerEvent.triggerId + "}",
              },
            ],
          },
        });
      }
      // look through the event for the handler or add it if it doesn't exist
      else {
        if (!event.Handlers) {
          event.Handlers = { Handler: [] };
        }
        const handler = event.Handlers.Handler.find((h: any) => h["@_handlerUniqueId"] === "{" + registerEvent.triggerId + "}");
        if (!handler) {
          event.Handlers.Handler.push({
            "@_functionName": registerEvent.function,
            "@_libraryName": libraryName,
            "@_handlerUniqueId": "{" + registerEvent.triggerId + "}",
            "@_enabled": "true",
            "@_parameters": registerEvent.parameters ?? "",
            "@_passExecutionContext": registerEvent.executionContext ? "true" : "false",
          });
        }
        // update the handler if it exists
        else {
          handler["@_functionName"] = registerEvent.function;
          handler["@_parameters"] = registerEvent.parameters ?? "";
          handler["@_passExecutionContext"] = registerEvent.executionContext ? "true" : "false";
        }
      }
    }
    //remove any handlers from where the @_libraryName = libraryName but the handlerUniqueId is not in the groupedRegisterEvents
    if (form.form.form.events) {
      for (const event of form.form.form.events.event) {
        if (event.Handlers) {
          event.Handlers.Handler = event.Handlers.Handler.filter((h: any) => {
            return h["@_libraryName"] !== libraryName || groupedRegisterEvents[formId].find((r) => "{" + r.triggerId + "}" === h["@_handlerUniqueId"]);
          });
        }
      }
    }

    //remove any empty event arrays
    if (form.form.form.events) {
      form.form.form.events.event = form.form.form.events.event.filter((e: any) => {
        return e.Handlers && e.Handlers.Handler.length > 0;
      });
    }

    /* eslint-enable @typescript-eslint/naming-convention */
    context.channel.appendLine(`Saving Form: ${form.id}`);
    await form.saveForm();
  }
  context.channel.appendLine(`Publishing All Customisations`);
  await context.dataverse?.publishAllCustomisations();
  context.channel.appendLine(`Publish Complete`);
}

interface RegisterEvent {
  /**
   * The unique identifier of the form in Dataverse.
   * @member {string} RegisterEvent#formId
   */
  formId: string;
  /**
   * The event that the function should be triggered on.
   * @member {string} RegisterEvent#event
   */
  event: "onload" | "onsave";
  /**
   * The name of the function to be triggered. in Library.Class.Function format
   * @member {string} RegisterEvent#function
   */
  function: string;
  /**
   * Specifiy a Unique ID (GUID) for the trigger
   * @member {string} RegisterEvent#triggerId
   */
  triggerId: string;
  /**
   * whether to pass the execution context as the first parameter
   * @member {string} RegisterEvent#executionContext
   */
  executionContext: boolean;
  /**
   * Optionally, add extra paramaters to pass.
   * @member {string} RegisterEvent#parameters
   */
  parameters?: string;
}
