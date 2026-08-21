import * as vscode from "vscode";
import fs = require("fs");
import { createServicePrincipalString, getServicePrincipalString, getProjectType } from "./general/connectionStringManager";
import { DataverseContext } from "./general/dataverse/dataverseContext";
import { DataverseFormRecord } from "./general/dataverse/getDataverseForms";
import { workspaceFilePath } from "./general/paths";
import { parseConnectionString, buildConnectionString, getOrganizationUrl, mergeCredentialConnectionString } from "./general/connectionString";
import { parseAuthType, DataverseAuthType } from "./general/dataverse/authTypes";
import { ProjectTypes } from "./projectTypes/registry";
import type { DiscoveredComponent, Layout } from "./components/discovery";
import { migrateSettings } from "./general/settingsMigrations";
import { fsMigrationIo } from "./general/migrationIo";
import { FAILURE_MARKER, WARNING_MARKER } from "./panel/operationOutcome";
import path = require("path");

// The enum now lives in the project-type registry (single source of truth,
// #47/#100); re-exported here so existing imports keep working.
export { ProjectTypes };

export default class DataversePowerToolsContext {
  public dataverse: DataverseContext;
  public vscode: vscode.ExtensionContext;
  public channel: vscode.OutputChannel;
  public projectSettings: ProjectSettings = {};
  public connectionString: string = "";
  public template?: PowertoolsTemplate;
  private settingsFilename: string = "dataverse-powertools.json";
  public statusBar: vscode.StatusBarItem;
  /** True once workspace settings detection finished (mirrors the folderStateReady context key). */
  public folderStateReady: boolean = false;
  /** Set by the actions panel (#100); call after any state change the panel renders. */
  public refreshPanel?: () => void;
  /** Every component in the workspace (#47): folders holding dataverse-powertools.json,
   * root first. A single-project workspace has exactly the root component. */
  public components: DiscoveredComponent[] = [];
  /** The component the current command invocation targets (set on scoped facade
   * contexts by componentScopedContext; undefined = root/legacy behaviour). */
  public activeComponent?: DiscoveredComponent;
  private channelListeners = new Set<(line: string) => void>();
  constructor(vscodeContext: vscode.ExtensionContext) {
    this.vscode = vscodeContext;
    this.channel = vscode.window.createOutputChannel("dataverse-powertools");
    // Test-only seam: when DVPT_TEST_LOG_FILE is set (the e2e launcher), mirror
    // every channel line to that file so a post-run audit can scan the FULL log
    // for failure signatures the suites' coded gates didn't predict. Inert
    // otherwise. The UI's clear/scroll never touches the mirror.
    const testLogFile = process.env.DVPT_TEST_LOG_FILE;
    if (testLogFile) {
      const original = this.channel.appendLine.bind(this.channel);
      this.channel.appendLine = (value: string) => {
        try {
          require("fs").appendFileSync(testLogFile, value + "\n");
        } catch {
          /* never let the mirror break the extension */
        }
        original(value);
      };
    }
    // Channel tap: the activity feed decides success/failure from what a command actually reported
    // (#229), because most commands log a failure and then resolve normally. Wrapping LAST means the
    // test mirror above still sees every line.
    const appendLine = this.channel.appendLine.bind(this.channel);
    this.channel.appendLine = (value: string) => {
      appendLine(value);
      if (this.channelListeners.size > 0) {
        // appendLine is called with multi-line blocks (whole build output), so split before notifying.
        for (const line of String(value ?? "").split(/\r?\n/)) {
          for (const listener of [...this.channelListeners]) {
            try {
              listener(line);
            } catch {
              /* a listener must never break logging */
            }
          }
        }
      }
    };
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.tooltip = "Dataverse PowerTools";
    this.statusBar.command = "dataverse-powertools.openSettings";
    this.dataverse = new DataverseContext(this);
  }

  async openSettings() {
    await vscode.commands.executeCommand("dataversePowerToolsMenu.focus");
  }

  /** Subscribe to this context's output lines. Used by the activity feed to judge an operation's
   * outcome from what the command reported (#229). Dispose when the operation ends. */
  public onChannelLine(listener: (line: string) => void): { dispose(): void } {
    this.channelListeners.add(listener);
    return { dispose: () => this.channelListeners.delete(listener) };
  }

  /**
   * Report a failure the command HANDLES itself (logs and returns) rather than throws.
   *
   * Use this instead of a bare `channel.appendLine` for anything that means "the command did not do
   * its job": it writes the canonical marker the activity feed reads, so the operation shows as ✗
   * instead of ✓ (#229) without the feed having to guess from prose.
   */
  public reportFailure(detail: string, options: { toast?: string | false } = {}): void {
    this.channel.appendLine(`${FAILURE_MARKER} ${detail}`);
    this.channel.show(true);
    if (options.toast !== false) {
      vscode.window.showErrorMessage(options.toast ?? detail);
    }
  }

  /** Report that the operation finished but not everything it tried worked — ⚠ in the feed. */
  public reportWarning(detail: string): void {
    this.channel.appendLine(`${WARNING_MARKER} ${detail}`);
  }

  /** Set the status bar text with the Dataverse PowerTools icon so it's identifiable. */
  setStatusBar(text: string): void {
    this.statusBar.text = `$(database) ${text}`;
    this.statusBar.show();
  }

  private settingsFilePath(): string | undefined {
    // Component-scoped contexts read/write THEIR settings file (#47); the base
    // context keeps today's workspace-root behaviour.
    if (this.activeComponent) {
      return workspaceFilePath(this.activeComponent.root, this.settingsFilename);
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    return workspaceFilePath(folders[0].uri.fsPath, this.settingsFilename);
  }

  async writeSettings() {
    const filePath = this.settingsFilePath();
    if (filePath === undefined) {
      // No workspace folder, so there is nowhere to write. This used to return silently while
      // the caller went on to log "Settings Saved!" — a lie that cost #268 a whole debugging
      // session: initialiseProject appeared to succeed, dataverse-powertools.json never existed,
      // and the first visible symptom was a missing prompt three steps later.
      this.reportFailure("Could not save project settings: no workspace folder is open. Open the project folder (File → Open Folder) and initialise again.", {
        toast: "No workspace folder is open — project settings were not saved.",
      });
      return;
    }
    let toWrite = JSON.parse(JSON.stringify(this.projectSettings));
    delete toWrite.pluginModelBuilder;
    // A subfolder component must not PERSIST fields it only inherited from the root
    // (connection, tenant, env). Discovery merges them into its in-memory settings for a
    // complete view, but writing them back would make the component self-contained — it
    // would then stop tracking the root's connection changes (#47).
    for (const field of this.activeComponent?.inheritedFields ?? []) {
      delete toWrite[field];
    }
    if (typeof toWrite.connectionString === "string" && toWrite.connectionString.length > 0) {
      // Persist only the non-secret base; client id/secret live in secret storage.
      const parts = parseConnectionString(toWrite.connectionString);
      delete parts.clientId;
      delete parts.clientSecret;
      toWrite.connectionString = buildConnectionString(parts);
    }
    return new Promise<void>((resolve, reject) => {
      fs.writeFile(filePath, JSON.stringify(toWrite), (err) => {
        if (err) {
          this.channel.appendLine(`Error writing settings file: ${err}`);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async readSettings() {
    const filePath = this.settingsFilePath();
    if (filePath === undefined) {
      // Same silent-no-op trap as writeSettings (#268) — but only a channel line here, because
      // readSettings runs on activation in windows that legitimately have no folder open.
      this.channel.appendLine("No workspace folder is open, so no project settings were loaded.");
      return;
    }
    await this.readFileAsync(filePath)
      .then(async (data: any) => {
        // Central migration runner (#71): ordered, idempotent, versioned. The
        // io lets migrations touch sibling files (spkl.json, modelbuilder.json).
        const migration = migrateSettings(JSON.parse(data), fsMigrationIo(path.dirname(filePath)));
        if (migration.fromNewerVersion) {
          this.channel.appendLine(
            `Warning: dataverse-powertools.json was written by a NEWER extension (settingsVersion ${migration.settings.settingsVersion}). Update Dataverse PowerTools if anything misbehaves.`,
          );
        } else if (migration.applied.length > 0) {
          this.channel.appendLine(`Migrated settings: ${migration.applied.join("; ")}.`);
        }
        this.projectSettings = migration.settings as ProjectSettings;
        this.connectionString = this.projectSettings.connectionString || "";
        // Interactive (OAuth) connections carry no client secret — the persisted
        // connection string is complete on its own, so don't look up a stored secret
        // or re-run the setup wizard (which asks for the auth type again).
        if (parseAuthType(parseConnectionString(this.connectionString).authType) !== DataverseAuthType.oauth) {
          const name = getOrganizationUrl(this.connectionString);
          const credentialString = await getServicePrincipalString(this, name);
          if (credentialString === "") {
            await createServicePrincipalString(this);
            this.connectionString = this.projectSettings.connectionString || "";
          } else {
            // Merge the stored base (AuthType/Url/…) with the secret-storage
            // ClientId/ClientSecret. A plain `+=` glued `Url=<url>` and `ClientId=…`
            // together (the persisted base has no trailing `;`), producing an invalid
            // connection string that broke auth and typings on every reload.
            this.connectionString = mergeCredentialConnectionString(this.projectSettings.connectionString, credentialString);
          }
        }
      })
      .catch((err) => {
        if (err.code === "ENOENT") {
          this.channel.appendLine(`No project settings file found in the root of the workspace. Run the 'Dataverse PowerTools: Initialise Project' command to create one.`);
        } else {
          this.channel.appendLine(`Error reading settings file: ${err}`);
        }
      });
  }

  async readFileAsync(filePath: string) {
    const data = await fs.promises.readFile(filePath);
    return data;
  }
}

interface ProjectSettings {
  placeholders?: TemplatePlaceholder[];
  type?: ProjectTypes;
  templateversion?: number;
  /** Settings schema version (#71) — stamped/migrated by settingsMigrations.ts. */
  settingsVersion?: number;
  /** Web resource build output (#88): one bundled library (default) or one JS per source file. */
  webresourceOutput?: "bundle" | "perFile";
  /** Bundle-mode output name (#258): the deployed resource is `{prefix}_{this}.js`, default
   * `library`. Set per component at scaffold so two web-resource components in one workspace
   * don't deploy over each other. Read at BUILD time by the project's webpack.common.js. */
  webresourceLibraryName?: string;
  tenantId?: string;
  /** Optional environment tag (e.g. DEV / TEST / PROD) shown as a badge in the actions panel. */
  environmentLabel?: string;
  /** Environment GUID (from Global Discovery) — addresses the Admin Center / Maker Portal. */
  environmentId?: string;
  /** Revision of the type's template CONFIG FILES this project last received (#113). */
  configRevision?: number;
  /** Sidebar arrangement of sub-components (#118) — only on the root (Empty) settings. */
  layout?: Layout;
  solutionName?: string;
  webresourceSolutionName?: string;
  connectionString?: string;
  prefix?: string;
  pluginProjectName?: string;
  pluginPackageName?: string;
  pluginPackageVersion?: string;
  pluginUnitTestingEnabled?: boolean;
  pluginUnitTestingFramework?: "mstest" | "xunit" | "nunit";
  pluginUnitTestingProject?: string;
  pluginModelBuilder?: PluginModelBuilderSettings;
  controlName?: string;
  /** Azure Function (#145): how the function is triggered — "webhook" | "http" | "timer" | "servicebus".
   * A function component need not be a Dataverse webhook; this is chosen at scaffold time. */
  azureFunctionTrigger?: string;
  /** Azure Function (#145): the Dataverse webhook (serviceendpoint) name this component registers as. */
  azureFunctionEndpointName?: string;
  /** Azure Function (#145): the function's HTTPS endpoint. NON-SECRET — the webhook key lives in secret storage. */
  azureFunctionUrl?: string;
  formIntersect?: FormIntersect[];
  /** Power Pages (#74): the remembered site + download folder for this component. */
  portalWebsiteId?: string;
  portalWebsiteName?: string;
  portalDownloadPath?: string;
  /** Solution pack/unpack config — replaces the legacy spkl.json (migrated on first read). */
  solutionConfig?: {
    uniqueName: string;
    packagePath: string;
    zipPath: string;
    packageType: "Managed" | "Unmanaged" | "Both";
  };
}

export interface PluginModelBuilderSettings {
  namespace?: string;
  serviceContextName?: string;
  outputDirectory?: string;
  emitEntityEtc?: boolean;
  emitFieldsClasses?: boolean;
  emitVirtualAttributes?: boolean;
  entityNamesFilter?: string[];
  entityTypesFolder?: string;
  generateGlobalOptionSets?: boolean;
  generateSdkMessages?: boolean;
  logLevel?: string;
  messageNamesFilter?: string[];
  messagesTypesFolder?: string;
  optionSetsTypesFolder?: string;
  suppressGeneratedCodeAttribute?: boolean;
  suppressINotifyPattern?: boolean;
}

export interface FormIntersect {
  id: string;
  name: string;
  entity: string;
  forms: DataverseFormRecord[];
}

export interface TemplatePlaceholder {
  placeholder: string;
  value: string;
}

export interface PowertoolsTemplate {
  version: number;
  files?: File[];
  placeholders?: Placeholder[];
  initCommands?: RestoreCommand[];
  restoreCommands?: RestoreCommand[];
}
interface File {
  path: string[];
  filename: string;
  extension: string;
  version: number;
  // When false, the file is a template used on-demand by a Create * command
  // (createTemplatedFile looks it up by filename) but is NOT copied into a new
  // project by generateTemplates. Defaults to true (scaffolded) when omitted.
  scaffold?: boolean;
}

interface Placeholder {
  displayName: string;
  placeholder: string;
}

export interface RestoreCommand {
  command: string;
  params: string[];
}
