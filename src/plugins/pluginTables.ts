import * as vscode from "vscode";
import fs = require("fs");
import DataversePowerToolsContext from "../context";
import { getProjectName } from "./earlybound";
import { getDataverseTablesFromContext } from "../general/dataverseContext";

export function pluginTableSelector(context: DataversePowerToolsContext) {
  new TreeDataProvider(context);
}

class TreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  context: DataversePowerToolsContext;
  data: TreeItem[];
  allTables: TreeItem[] = [];
  count = 0;

  constructor(context: DataversePowerToolsContext) {
    this.context = context;
    this.data = [
      new TreeItem("Selected Tables", [], undefined, "SelectedRoot"),
      new TreeItem("Available Tables", [], undefined, "AvailableRoot"),
      new TreeItem("Selected Actions", [], undefined, "SelectedRoot"),
    ];
    this.data[0].children = this.getSelectedTables(EarlyboundType.table);
    this.getDataverseTables();
    this.data[2].children = this.getSelectedTables(EarlyboundType.action);
    const options = {
      treeDataProvider: this,
      showCollapseAll: true,
    };

    vscode.window.registerTreeDataProvider("dataversePowerToolsTree", this);
    vscode.commands.registerCommand("dataversePowerToolsTree.updateTree", () => {
      this.getDataverseTables();
    });
    vscode.commands.registerCommand("dataversePowerToolsTree.manualAddToTree", (event) => {
      console.log(event);
      if (event.label === "Selected Tables") {
        vscode.window.showInputBox({ prompt: "Enter the name of the table to add" }).then((table) => {
          if (table) {
            this.data[0].children?.push({
              label: table,
              id: table,
              contextValue: "Selected",
              type: EarlyboundType.table,
            } as TreeItem);
            this.saveAvailableToSpklFile();
            this.refresh();
          }
        });
      } else if (event.label === "Selected Actions") {
        vscode.window.showInputBox({ prompt: "Enter the name of the action to add" }).then((action) => {
          if (action) {
            this.data[2].children?.push({
              label: action,
              id: action,
              contextValue: "Selected",
              type: EarlyboundType.action,
            } as TreeItem);
            this.saveAvailableToSpklFile();
            this.refresh();
          }
        });
      }
    });
    vscode.commands.registerCommand("dataversePowerToolsTree.addEntry", (event) => {
      // add to selected
      event.contextValue = "Selected";
      this.data[0].children?.push(event);
      // remove from available
      this.data[1].children = this.data[1].children?.filter((i) => i.label !== event.label);
      this.saveAvailableToSpklFile();
      this.refresh();
    });

    vscode.commands.registerCommand("dataversePowerToolsTree.deleteEntry", (event) => {
      if (event.type === EarlyboundType.table) {
        event.contextValue = "Available";
        this.data[1].children?.push(event);
        console.log(this.data[1].children);
        // remove from selected
        this.data[0].children = this.data[0].children?.filter((i) => i.label !== event.label);
      } else if (event.type === EarlyboundType.action) {
        // remove from selected
        this.data[2].children = this.data[2].children?.filter((i) => i.label !== event.label);
      }
      this.saveAvailableToSpklFile();
      this.refresh();
    });

    const tree = vscode.window.createTreeView("dataversePowerToolsTree", options);
    context.vscode.subscriptions.push(tree);
  }

  refresh(): void {
    this.data[0].children = this.data[0].children?.sort((a, b) => (!a.label || !b.label ? -1 : a.label > b.label ? 1 : -1));
    this.data[1].children = this.data[1].children?.sort((a, b) => (!a.label || !b.label ? -1 : a.label > b.label ? 1 : -1));
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  getChildren(element?: TreeItem | undefined): vscode.ProviderResult<TreeItem[]> {
    if (element === undefined) {
      return this.data;
    }
    return element.children ? element.children : [];
  }

  async getDataverseTables(): Promise<void> {
    const tableArray = await getDataverseTablesFromContext(this.context);
    this.allTables = tableArray.map((table) => {
      return {
        label: table,
        id: table,
        contextValue: "Available",
        type: EarlyboundType.table,
      } as TreeItem;
    });
    this.data[1].children = this.allTables.filter((table) => !this.data[0].children?.some((selectedTable) => selectedTable.label === table.label));
    this.refresh();
  }

  async saveAvailableToSpklFile(): Promise<void> {
    if (!vscode.workspace.workspaceFolders) {
      return;
    }
    const solutionName = getProjectName(this.context);
    var spklFile = JSON.parse(fs.readFileSync(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName + "\\spkl.json", "utf8")) as Spkl;
    spklFile.earlyboundtypes[0].entities = this.data[0].children?.map((table) => table.label).join(",") ?? "";
    spklFile.earlyboundtypes[0].actions = this.data[2].children?.map((action) => action.label).join(",") ?? "";
    fs.writeFileSync(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName + "\\spkl.json", JSON.stringify(spklFile, null, 2));
  }

  getSelectedTables(type: EarlyboundType): TreeItem[] {
    if (!vscode.workspace.workspaceFolders) {
      return [];
    }
    const solutionName = getProjectName(this.context);
    var spklFile = JSON.parse(fs.readFileSync(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName + "\\spkl.json", "utf8")) as Spkl;
    if (type === EarlyboundType.table) {
      if (spklFile.earlyboundtypes[0].entities === "" || spklFile.earlyboundtypes[0].entities === undefined) {
        return [];
      }
      return spklFile.earlyboundtypes[0].entities.split(",").map((table) => {
        return {
          label: table,
          id: table,
          contextValue: "Selected",
          type: EarlyboundType.table,
        } as TreeItem;
      });
    } else if (type === EarlyboundType.action) {
      if (spklFile.earlyboundtypes[0].actions === "" || spklFile.earlyboundtypes[0].entities === undefined) {
        return [];
      }
      return spklFile.earlyboundtypes[0].actions.split(",").map((action) => {
        return {
          label: action,
          id: action,
          contextValue: "Selected",
          type: EarlyboundType.action,
        } as TreeItem;
      });
    }
    return [];
  }
}

enum EarlyboundType {
  table,
  action,
}

interface Spkl {
  earlyboundtypes: [
    {
      entities: string;
      actions: string;
    },
  ];
}

class TreeItem extends vscode.TreeItem {
  command?: vscode.Command | undefined;
  children?: TreeItem[] | undefined;
  contextValue?: string | undefined;
  type?: EarlyboundType | undefined;

  constructor(label: string, children?: TreeItem[] | undefined, command?: vscode.Command, contextValue?: string) {
    super(label, children === undefined ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded);
    this.command = command;
    this.contextValue = contextValue;
    if (this.label === "Available Tables" || this.label === "Available Actions") {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    }
  }
}
