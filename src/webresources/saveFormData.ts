import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { DataverseForm } from "../general/dataverse/DataverseForm";
import { randomUUID } from "crypto";
import { parseRegisterEvents, validateRegisterEvent, RegisterEventDecoration } from "./registerEventParser";
import { webresourceLibraryName, candidateLibraryNames, libraryBaseFor, isPerFileEntry, pathBelowSourceRoot } from "./libraryNames";
import { applyFormRegistrations, ResolvedRegistration } from "./formRegistrationXml";
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
  const unbuildable: string[] = [];
  // In per-file mode only the TOP-LEVEL webresources_src/*.ts are webpack entries, but this scan
  // is recursive and includes library.ts — so a registration in a nested file, or in the barrel,
  // used to bind a handler to a web resource that mode never builds or deploys. The form then
  // referenced a <Library> that isn't in the environment. Skip those and say which, rather than
  // writing a registration that cannot work.
  const perFileMode = context.projectSettings.webresourceOutput === "perFile";
  for (const file of files) {
    if (perFileMode && !isPerFileEntry(pathBelowSourceRoot(file.fsPath))) {
      const document = await vscode.workspace.openTextDocument(file);
      if (parseRegisterEvents(document.getText()).events.length > 0) {
        unbuildable.push(vscode.workspace.asRelativePath(file));
      }
      continue;
    }
    const document = await vscode.workspace.openTextDocument(file);
    const parsed = parseRegisterEvents(document.getText());
    malformedBlocks += parsed.malformedBlocks;
    // The source file decides WHICH library the handler binds to in per-file mode (#88).
    registerEvents.push(...parsed.events.map((event) => ({ ...event, sourceFile: file.fsPath })));
  }
  if (malformedBlocks > 0) {
    context.channel.appendLine(`Warning: skipped ${malformedBlocks} malformed RegisterEvent decoration block(s).`);
  }
  if (unbuildable.length > 0) {
    context.channel.appendLine(
      `Warning: skipped form registrations in ${unbuildable.length} file(s) that per-file output mode does not build, so no web resource would exist to bind to: ${unbuildable.join(", ")}. ` +
        `Per-file mode builds only the top-level webresources_src/*.ts (not library.ts) — move the registration into one of those, or switch to the bundled output mode.`,
    );
    vscode.window.showWarningMessage(`${unbuildable.length} form registration file(s) are not built in per-file mode and were skipped — see the log.`);
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
  const bundleBase = libraryBaseFor(context.projectSettings);
  const libraryFor = (event: SourcedRegisterEvent) => webresourceLibraryName(prefix, outputMode, event.sourceFile, bundleBase);
  // Only handlers bound to one of OUR possible library names (either mode) may be
  // cleaned up — other solutions' handlers on the same form are untouchable.
  const ownedLibraries = candidateLibraryNames(
    prefix,
    files.map((file) => file.fsPath),
    bundleBase,
    context.projectSettings.webresourcePreviousLibraryNames ?? [],
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
    // Resolve each event's library (prefix + output mode + source file) up front, then
    // apply the form-XML mutation via the pure, unit-tested builder (formRegistrationXml).
    const registrations: ResolvedRegistration[] = groupedRegisterEvents[formId].map((registerEvent) => ({
      event: registerEvent.event,
      function: registerEvent.function,
      libraryName: libraryFor(registerEvent),
      parameters: registerEvent.parameters,
      executionContext: registerEvent.executionContext,
      triggerId: registerEvent.triggerId,
    }));
    applyFormRegistrations(form.form.form, registrations, ownedLibraries, randomUUID);

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
