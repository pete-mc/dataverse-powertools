import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { DataverseForm } from "../general/dataverse/DataverseForm";
import { randomUUID } from "crypto";
import { parseRegisterEvents, validateRegisterEvent, RegisterEventDecoration } from "./registerEventParser";
import { webresourceLibraryName, candidateLibraryNames } from "./libraryNames";
import { activeComponentRoot } from "../components/componentDiscovery";

type SourcedRegisterEvent = RegisterEventDecoration & { sourceFile: string };

export async function saveFormData(context: DataversePowerToolsContext): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Registering form events...",
    },
    async () => {
      try {
        const registered = await saveFormDataExec(context);
        if (registered) {
          vscode.window.showInformationMessage("All events registered.");
        } else {
          vscode.window.showInformationMessage("No form event registrations found in webresources_src.");
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(e?.message || "Error registering events.");
        context.channel.show();
      }
    },
  );
}

/** Register all decorated form events. Returns false when the project has no
 * RegisterEvent decorations (nothing to do — no publish, no popup).
 * Pass publish:false to defer publish-all to the caller (deploy flow). */
export async function saveFormDataExec(context: DataversePowerToolsContext, options?: { publish?: boolean }): Promise<boolean> {
  context.channel.appendLine("Saving Forms...");

  const componentRoot = activeComponentRoot(context);
  const files = componentRoot
    ? await vscode.workspace.findFiles(new vscode.RelativePattern(componentRoot, "webresources_src/**/*.ts"))
    : await vscode.workspace.findFiles("webresources_src/**/*.ts");
  const registerEvents: SourcedRegisterEvent[] = [];
  let malformedBlocks = 0;
  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file);
    const parsed = parseRegisterEvents(document.getText());
    malformedBlocks += parsed.malformedBlocks;
    // The source file decides WHICH library the handler binds to in per-file mode (#88).
    registerEvents.push(...parsed.events.map((event) => ({ ...event, sourceFile: file.fsPath })));
  }
  if (malformedBlocks > 0) {
    context.channel.appendLine(`Warning: skipped ${malformedBlocks} malformed RegisterEvent decoration block(s).`);
  }

  if (registerEvents.length === 0) {
    context.channel.appendLine("No form event registrations found; nothing to register.");
    return false;
  }

  // Validate EVERY decoration before touching any form — an invalid field used
  // to serialize into schema-breaking form XML (missing required attributes,
  // rejected by Dataverse with 0x80048425).
  const problems = registerEvents.map((event) => ({ event, problem: validateRegisterEvent(event) })).filter((entry) => entry.problem);
  if (problems.length > 0) {
    for (const { event, problem } of problems) {
      context.channel.appendLine(`Invalid RegisterEvent decoration (${event.function || event.formId || "unknown"}): ${problem}`);
    }
    context.channel.show();
    throw new Error(`${problems.length} RegisterEvent decoration(s) are invalid — see the Dataverse PowerTools output. No forms were changed.`);
  }

  //Group the PowerTools.RegisterEvent objects by formId
  const groupedRegisterEvents = registerEvents.reduce(
    (acc, cur) => {
      (acc[cur.formId] = acc[cur.formId] || []).push(cur);
      return acc;
    },
    {} as { [key: string]: SourcedRegisterEvent[] },
  );

  // Library names come from settings (prefix + output mode, #88). The old
  // webpack.common.js filename scrape stopped matching when the template gained
  // the per-file output ternary, returned undefined, and serialized a <Library>
  // element WITHOUT its required `name` attribute — Dataverse rejected the whole
  // form with 0x80048425. Never write a form without a resolved library name.
  const prefix = context.projectSettings.prefix;
  if (!prefix) {
    throw new Error("No publisher prefix in dataverse-powertools.json — cannot determine the web resource library name. No forms were changed.");
  }
  const outputMode = context.projectSettings.webresourceOutput;
  const libraryFor = (event: SourcedRegisterEvent) => webresourceLibraryName(prefix, outputMode, event.sourceFile);
  // Only handlers bound to one of OUR possible library names (either mode) may be
  // cleaned up — other solutions' handlers on the same form are untouchable.
  const ownedLibraries = candidateLibraryNames(
    prefix,
    files.map((file) => file.fsPath),
  );

  let totalForms = 0;
  let failedForms = 0;
  for (const formId in groupedRegisterEvents) {
    totalForms++;
    const form = new DataverseForm(formId, context);
    // If the form can't be loaded, don't touch form.form (it's undefined) — record the failure and
    // move on so the remaining forms are still attempted, but the run is reported as unsuccessful.
    if (!(await form.getFormData())) {
      failedForms++;
      continue;
    }
    /* eslint-disable @typescript-eslint/naming-convention */
    if (!form.form.form.formLibraries) {
      form.form.form.formLibraries = { Library: [] };
    }
    // One <Library> per distinct library the form's events bind to (per-file
    // mode can need several; bundle mode needs one).
    for (const neededLibrary of new Set(groupedRegisterEvents[formId].map(libraryFor))) {
      if (!form.form.form.formLibraries.Library.find((l: any) => l["@_name"] === neededLibrary)) {
        form.form.form.formLibraries.Library.push({
          "@_name": neededLibrary,
          "@_libraryUniqueId": "{" + randomUUID() + "}", //create a random guid
        });
      }
    }
    //loop through the groupedRegisterEvents and add the events to the form
    for (const registerEvent of groupedRegisterEvents[formId]) {
      const libraryName = libraryFor(registerEvent);
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
          handler["@_libraryName"] = libraryName;
          handler["@_parameters"] = registerEvent.parameters ?? "";
          handler["@_passExecutionContext"] = registerEvent.executionContext ? "true" : "false";
        }
      }
    }
    //remove any handlers bound to one of OUR library names (either output mode) whose
    //handlerUniqueId is no longer decorated — other solutions' handlers are untouchable
    if (form.form.form.events) {
      for (const event of form.form.form.events.event) {
        if (event.Handlers) {
          event.Handlers.Handler = event.Handlers.Handler.filter((h: any) => {
            return !ownedLibraries.has(h["@_libraryName"]) || groupedRegisterEvents[formId].find((r) => "{" + r.triggerId + "}" === h["@_handlerUniqueId"]);
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
    if (!(await form.saveForm())) {
      failedForms++;
    }
  }
  if (options?.publish !== false) {
    context.channel.appendLine(`Publishing All Customisations`);
    if (await context.dataverse?.publishAllCustomisations()) {
      context.channel.appendLine(`Publish Complete`);
    } else {
      throw new Error("Publish failed — see the Dataverse PowerTools output for details.");
    }
  }

  // Don't let a per-form failure (e.g. the web resource isn't deployed yet — 0x8004F036) look like
  // success: surface it so the command reports an error instead of "All events registered" (#90).
  if (failedForms > 0) {
    throw new Error(`Failed to register events on ${failedForms} of ${totalForms} form(s). See the Dataverse PowerTools output for details.`);
  }
  return true;
}

// The RegisterEvent decoration shape is documented on RegisterEventDecoration
// in ./registerEventParser.ts (shared with the actions panel's scanner).
