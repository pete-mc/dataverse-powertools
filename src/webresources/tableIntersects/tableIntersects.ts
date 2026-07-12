import * as vscode from "vscode";
import DataversePowerToolsContext, { FormIntersect } from "../../context";
import { DataverseFormRecord, getDataverseForms } from "../../general/dataverse/getDataverseForms";
import { collectNewIntersectInputs } from "./collectNewIntersectInputs";
import { randomUUID } from "crypto";

// One tree view can't represent several web-resource components at once (#47), so
// the tree is no longer loaded at activation: "Configure form intersects" in a
// project card's overflow menu creates it on first use and retargets it at the
// invoking component after that. The singleton also guards the constructor's
// registerCommand calls from running twice.
let provider: TreeDataProvider | undefined;

export async function openFormIntersects(context: DataversePowerToolsContext): Promise<void> {
  if (!provider) {
    provider = new TreeDataProvider(context);
  } else {
    await provider.setContext(context);
  }
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.formIntersectTreeLoaded", true);
  await vscode.commands.executeCommand("dataversePowerToolsTableIntersectTree.focus");
}

class TreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  context: DataversePowerToolsContext;
  private view!: vscode.TreeView<TreeItem>;

  constructor(context: DataversePowerToolsContext) {
    this.context = context;
    const options = {
      treeDataProvider: this,
      showCollapseAll: true,
    };

    // createTreeView below registers the provider; no separate registerTreeDataProvider needed.
    vscode.commands.registerCommand("dataversePowerToolsTableIntersectTree.updateTree", async () => {
      await this.context.readSettings();
      this.refresh();
    });
    // The handlers read this.context (not the constructor's context) so
    // setContext() retargets them at the currently selected component.
    vscode.commands.registerCommand("dataversePowerToolsTableIntersectTree.addNewFormIntersect", async () => {
      // add prompt to select entity and two more prompts to select the first two forms from dataverse
      let state = { context: this.context, error: false, forms: [] as DataverseFormRecord[] } as NewIntersectState;
      state = await collectNewIntersectInputs(state);
      if (state.error) {
        vscode.window.showErrorMessage("Unable to create new form intersect, see output for more details.");
        this.context.channel.show();
        return;
      }
      if (this.context.projectSettings.formIntersect === undefined) {
        this.context.projectSettings.formIntersect = [];
      }
      const newIntersect = { name: state.intersectName, entity: state.entity, forms: state.forms, id: randomUUID() } as FormIntersect;
      this.context.projectSettings.formIntersect.push(newIntersect);
      await this.saveProjectSettings();
    });

    vscode.commands.registerCommand("dataversePowerToolsTableIntersectTree.removeNewFormIntersect", async (event: TreeItem) => {
      const formIntersect = this.context.projectSettings.formIntersect?.find((fi) => fi.id === (event.originalItem as FormIntersect).id);
      if (formIntersect === undefined || !this.context.projectSettings.formIntersect) {
        vscode.window.showErrorMessage("Unable to remove form intersect, form intersect not found.");
        return;
      }
      this.context.projectSettings.formIntersect = this.context.projectSettings.formIntersect.filter((fi) => fi.id !== formIntersect.id);
      await this.saveProjectSettings();
    });

    vscode.commands.registerCommand("dataversePowerToolsTableIntersectTree.addForm", async (event: TreeItem) => {
      // add prompt to add new form to entity
      const formslist = (await getDataverseForms(this.context, (event.originalItem as FormIntersect).entity)).map((form) => {
        return { label: form.displayName + " [" + form.formType + "]", target: form };
      });
      const selectedForm = await vscode.window.showQuickPick(formslist, { placeHolder: "Select form to add" });
      const formIntersect = this.context.projectSettings.formIntersect?.find((fi) => fi.id === (event.originalItem as FormIntersect).id);
      if (selectedForm === undefined || formIntersect === undefined) {
        vscode.window.showErrorMessage("Unable to add form, no form selected or form intersect not found.");
        return;
      }
      formIntersect.forms.push(selectedForm.target);
      this.saveProjectSettings();
    });

    vscode.commands.registerCommand("dataversePowerToolsTableIntersectTree.removeForm", (event: TreeItem) => {
      // Check if parent has at least 2 other children, throw error if not
      const formIntersect = this.context.projectSettings.formIntersect?.find((fi) => fi.name === event.parentName);
      if (formIntersect === undefined) {
        vscode.window.showErrorMessage("Unable to remove form, form intersect not found.");
        return;
      }
      if (formIntersect.forms.length <= 2) {
        vscode.window.showErrorMessage("Unable to remove form, form intersect must have at least 2 forms.");
        return;
      }
      // Remove item from parent
      formIntersect.forms = formIntersect.forms.filter((f) => f.formId !== (event.originalItem as DataverseFormRecord).formId);
      this.saveProjectSettings();
    });

    this.view = vscode.window.createTreeView("dataversePowerToolsTableIntersectTree", options);
    context.vscode.subscriptions.push(this.view);
    this.updateViewDescription();
  }

  /** Point the tree at a (possibly different) component's context and re-read
   * its settings — how one view serves many web-resource components. */
  async setContext(context: DataversePowerToolsContext): Promise<void> {
    this.context = context;
    this.updateViewDescription();
    await this.context.readSettings();
    this.refresh();
  }

  /** Show which component the tree is editing when it isn't the workspace root. */
  private updateViewDescription(): void {
    const component = this.context.activeComponent;
    this.view.description = component && !component.isRoot ? component.relativeRoot : undefined;
  }

  get data(): TreeItem[] {
    if (this.context.projectSettings.formIntersect && this.context.projectSettings.formIntersect.length > 0) {
      return this.context.projectSettings.formIntersect.map((fi) => {
        return new TreeItem(
          fi.name,
          fi.forms.map((f) => {
            return new TreeItem(f.displayName, undefined, undefined, "form", f, fi.name);
          }),
          undefined,
          "formintersect",
          fi,
          undefined,
        );
      });
    } else {
      return [];
    }
  }

  refresh(): void {
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

  async saveProjectSettings(): Promise<void> {
    await this.context.writeSettings();
    this.refresh();
  }
}

class TreeItem extends vscode.TreeItem {
  command?: vscode.Command | undefined;
  children?: TreeItem[] | undefined;
  contextValue?: string | undefined;
  originalItem?: DataverseFormRecord | FormIntersect | undefined;
  parentName?: string | undefined;

  constructor(
    label: string,
    children?: TreeItem[] | undefined,
    command?: vscode.Command,
    contextValue?: string,
    originalItem?: DataverseFormRecord | FormIntersect | undefined,
    parentName?: string,
  ) {
    super(label, children === undefined ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded);
    this.parentName = parentName;
    this.children = children;
    this.command = command;
    this.originalItem = originalItem;
    this.contextValue = contextValue;
  }
}

export interface NewIntersectState {
  error: boolean;
  tables: { label: string }[];
  intersectName: string;
  context: DataversePowerToolsContext;
  forms: DataverseFormRecord[];
  formsQuestions: {
    label: string;
    target: DataverseFormRecord;
  }[];
  entity: string;
}
