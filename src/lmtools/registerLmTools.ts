// vscode binding for the Language Model Tools surface (#140). Registers each tool
// ONCE, globally (not in any per-component initialise* — the multi-component
// registration trap). Read tools return secret-free summaries; mutating tools are
// gated on the read-write access mode and show a native per-call confirmation via
// prepareInvocation. Handlers are thin wrappers over the same command paths the UI
// uses (executeCommand), so a future MCP surface can reuse the pure logic in
// lmTools.ts.

import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { getOrganizationUrl, parseConnectionString } from "../general/connectionString";
import { parseAuthType, DataverseAuthType } from "../general/dataverse/authTypes";
import { getSystemRequirementsStatus } from "../general/systemRequirements";
import { ComponentSettings } from "../components/discovery";
import { LM_TOOLS, LmToolSpec, AccessMode, isToolAllowed, readOnlyRefusal, formatConnectionSummary, formatComponentList, formatRequirements } from "./lmTools";

function currentAccessMode(): AccessMode {
  return vscode.workspace.getConfiguration("dataverse-powertools").get<string>("copilot.accessMode") === "readwrite" ? "readwrite" : "readonly";
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function connectionResult(context: DataversePowerToolsContext): vscode.LanguageModelToolResult {
  const loaded = !!context.projectSettings?.connectionString;
  const parts = parseConnectionString(context.connectionString);
  return textResult(
    formatConnectionSummary({
      loaded,
      organizationUrl: loaded ? getOrganizationUrl(context.connectionString) : undefined,
      authType: loaded && parseAuthType(parts.authType) === DataverseAuthType.oauth ? "oauth" : "clientsecret",
      connected: !!context.dataverse?.isValid,
    }),
  );
}

function componentsResult(context: DataversePowerToolsContext): vscode.LanguageModelToolResult {
  const components = (context.components ?? [])
    .filter((c) => c.settings?.type)
    .map((c) => {
      const settings = c.settings as ComponentSettings;
      return {
        type: settings.type ?? "",
        name: (settings.solutionName as string) || (settings.pluginProjectName as string) || c.relativeRoot || "",
        relativeRoot: c.relativeRoot,
        isRoot: c.isRoot,
      };
    });
  return textResult(formatComponentList(components));
}

function requirementsResult(): vscode.LanguageModelToolResult {
  const snapshot = getSystemRequirementsStatus();
  return textResult(
    formatRequirements([
      { name: "dotnet", installed: snapshot.dotnet },
      { name: "node", installed: snapshot.node },
      { name: "pac", installed: snapshot.pac },
    ]),
  );
}

function makeTool(context: DataversePowerToolsContext, spec: LmToolSpec): vscode.LanguageModelTool<unknown> {
  return {
    async invoke(): Promise<vscode.LanguageModelToolResult> {
      if (spec.mutating && !isToolAllowed(spec, currentAccessMode())) {
        return textResult(readOnlyRefusal(spec.name));
      }
      switch (spec.name) {
        case "dvpt_connectionStatus":
          return connectionResult(context);
        case "dvpt_listComponents":
          return componentsResult(context);
        case "dvpt_systemRequirements":
          return requirementsResult();
        default:
          if (spec.command) {
            await vscode.commands.executeCommand(spec.command);
            return textResult(`Ran "${spec.confirmTitle ?? spec.name}". See the Dataverse PowerTools output channel for details.`);
          }
          return textResult(`Unknown tool: ${spec.name}.`);
      }
    },
    prepareInvocation: spec.mutating
      ? async (): Promise<vscode.PreparedToolInvocation | undefined> => {
          if (!isToolAllowed(spec, currentAccessMode())) {
            // No confirmation dialog; invoke() returns the read-only guidance instead.
            return undefined;
          }
          const org = getOrganizationUrl(context.connectionString) || "the connected environment";
          return {
            confirmationMessages: {
              title: spec.confirmTitle ?? "Run Dataverse PowerTools tool",
              message: new vscode.MarkdownString(`This will run **${spec.confirmTitle ?? spec.name}** against \`${org}\`.`),
            },
          };
        }
      : undefined,
  };
}

/** Register every LM tool once. No-op on hosts without the API (extension still activates). */
export function registerLmTools(context: DataversePowerToolsContext): void {
  if (!vscode.lm || typeof vscode.lm.registerTool !== "function") {
    return;
  }
  for (const spec of LM_TOOLS) {
    context.vscode.subscriptions.push(vscode.lm.registerTool(spec.name, makeTool(context, spec)));
  }
}
