import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { componentForPath } from "../components/discovery";
import { runForComponent } from "../components/componentDiscovery";
import { ProjectTypes } from "../projectTypes/registry";
import { profilePluginStep, stopProfilingPluginStep } from "./profileStep";

// CodeLens profiler toggle (#112): "Profile this step" / "Stop profiling" above
// [CrmPluginRegistration]-decorated classes. The lens resolves the owning
// component and runs the existing profileStep flows PRE-FILTERED to the class's
// fully-qualified type name — same rails (backup-first, own-assembly only).

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

/** Whether an un-restored profiler backup exists for this type (drives which lens shows). */
function hasBackupForType(componentRoot: string, typeName: string): boolean {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(componentRoot, ".dvpt-profiler-backup.json"), "utf8")) as Record<string, { typename?: string }>;
    return Object.values(store).some((snapshot) => snapshot.typename === typeName);
  } catch {
    return false;
  }
}

class ProfilerCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly context: DataversePowerToolsContext) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const component = componentForPath(this.context.components ?? [], document.uri.fsPath);
    if (component?.settings.type !== ProjectTypes.plugin) {
      return [];
    }
    const lenses: vscode.CodeLens[] = [];
    for (const site of findPluginClasses(document.getText())) {
      const range = new vscode.Range(site.line, 0, site.line, 0);
      if (hasBackupForType(component.root, site.typeName)) {
        lenses.push(
          new vscode.CodeLens(range, { title: "$(debug-stop) Stop profiling", command: "dataverse-powertools.codelensStopProfiling", arguments: [site.typeName, document.uri] }),
        );
      } else {
        lenses.push(
          new vscode.CodeLens(range, { title: "$(record) Profile this step", command: "dataverse-powertools.codelensProfileStep", arguments: [site.typeName, document.uri] }),
        );
      }
    }
    return lenses;
  }
}

/** Register the provider + the two internal lens commands ONCE at activation. */
export function registerProfilerCodeLens(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "csharp", scheme: "file" }, new ProfilerCodeLensProvider(context)),
    vscode.commands.registerCommand("dataverse-powertools.codelensProfileStep", (typeName: string, uri: vscode.Uri) =>
      runForComponent(context, ProjectTypes.plugin, uri, (scoped) => profilePluginStep(scoped, typeName)),
    ),
    vscode.commands.registerCommand("dataverse-powertools.codelensStopProfiling", (typeName: string, uri: vscode.Uri) =>
      runForComponent(context, ProjectTypes.plugin, uri, (scoped) => stopProfilingPluginStep(scoped, typeName)),
    ),
  );
}
