import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { componentForPath } from "../components/discovery";
import { runForComponent } from "../components/componentDiscovery";
import { ProjectTypes } from "../projectTypes/registry";
import { guidePluginProfiling } from "./profilerGuide";

// CodeLens on [CrmPluginRegistration]-decorated plugin classes (#112): a single
// "Profile & debug…" entry that guides capture (via the Plugin Registration
// Tool) → Download → Replay-as-unit-test. Capturing itself isn't automated (the
// profiler must be installed via PRT to be pipeline-executable); the value we
// add is debugging the captured profile in VS Code.

export interface PluginClassSite {
  /** Fully-qualified type name (namespace.Class). */
  typeName: string;
  /** 0-based line of the class declaration. */
  line: number;
}

/** Find [CrmPluginRegistration]-decorated classes in C# source. Pure. */
export function findPluginClasses(source: string): PluginClassSite[] {
  const sites: PluginClassSite[] = [];
  const lines = source.split(/\r?\n/);
  let namespaceName = "";
  let pendingAttribute = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const ns = line.match(/^\s*namespace\s+([A-Za-z0-9_.]+)/);
    if (ns) {
      namespaceName = ns[1];
    }
    if (/\[\s*CrmPluginRegistration/.test(line)) {
      pendingAttribute = true;
    }
    const cls = line.match(/^\s*(?:public\s+|internal\s+|sealed\s+|partial\s+)*class\s+([A-Za-z0-9_]+)/);
    if (cls) {
      if (pendingAttribute) {
        sites.push({ typeName: namespaceName ? `${namespaceName}.${cls[1]}` : cls[1], line: index });
      }
      pendingAttribute = false;
    }
  }
  return sites;
}

class ProfilerCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly context: DataversePowerToolsContext) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const component = componentForPath(this.context.components ?? [], document.uri.fsPath);
    if (component?.settings.type !== ProjectTypes.plugin) {
      return [];
    }
    return findPluginClasses(document.getText()).map(
      (site) =>
        new vscode.CodeLens(new vscode.Range(site.line, 0, site.line, 0), {
          title: "$(debug-alt) Profile & debug…",
          command: "dataverse-powertools.codelensProfileGuide",
          arguments: [document.uri],
        }),
    );
  }
}

/** Register the provider + the lens command ONCE at activation. */
export function registerProfilerCodeLens(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "csharp", scheme: "file" }, new ProfilerCodeLensProvider(context)),
    vscode.commands.registerCommand("dataverse-powertools.codelensProfileGuide", (uri: vscode.Uri) =>
      runForComponent(context, ProjectTypes.plugin, uri, (scoped) => guidePluginProfiling(scoped)),
    ),
  );
}
