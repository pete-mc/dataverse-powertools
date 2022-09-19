import { TextEncoder } from "util";
import * as vscode from "vscode";
import * as cp from "child_process";
import path = require("path");
import { QuickPickItem, window, Disposable, CancellationToken, QuickInputButton, QuickInput, ExtensionContext, QuickInputButtons, Range, TextEdit } from 'vscode';
import DataversePowerToolsContext, { ProjectTypes } from "../DataversePowerToolsContext";

export async function createConnectionString(context: DataversePowerToolsContext) {
  interface State {
    title: string;
    step: number;
    organisationUrl: string;
    applicationId: string;
    totalSteps: number;
    name: string;
    clientSecret: string;
    solutionName: string;
    prefix: string;
    createCredential: boolean;
  }

  const title = 'Creating the Credentials';

  async function collectInputs() {
    const state = {} as Partial<State>;
    await MultiStepInput.run(input => inputURL(input, state));
    return state as State;
  }

  async function inputURL(input: MultiStepInput, state: Partial<State>) {
    state.organisationUrl = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 1,
      totalSteps: 5,
      value: typeof state.organisationUrl === 'string' ? state.organisationUrl : '',
      prompt: 'Type in the Organisation URl',
      validate: validateNameIsUnique,
      shouldResume: shouldResume,
    });
    return (input: MultiStepInput) => inputApplicationId(input, state);
  }

  async function inputApplicationId(input: MultiStepInput, state: Partial<State>) {
    if (vscode.workspace.workspaceFolders !== undefined) {
      const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates"));
      const util = require('util');
      const execSync = require("child_process").execSync;
      // const exec = util.promisify(require('child_process').execFile);
      // const promise = execSync(
      //   workspacePath + "\\WindowsCredentialManager.exe",
      //   ["Get-Credentials", state.organisationUrl || '', "username"]
      // );
      let command = "\"" + fullFilePath + "\\WindowsCredentialManager.exe\" Get-Credentials " + state.organisationUrl || '';
      command += ' username';
      const result = execSync(command);
      // var child2 = require('child_process').execSync(workspacePath + "\\WindowsCredentialManager.exe Get-Credentials " + state.organisationUrl || '' + " username")
      // const child = promise.child;
      // const { stdout, stderr } = promise;
      const credentialResult = result.toString("utf-8");
      if (credentialResult === '') {
        state.createCredential = true;
        state.applicationId = await input.showInputBox({
          ignoreFocusOut: true,
          title,
          step: 2,
          totalSteps: 5,
          value: state.applicationId || '',
          prompt: 'Type in the Application ID',
          validate: validateNameIsUnique,
          shouldResume: shouldResume
        });
        return (input: MultiStepInput) => inputClientSecret(input, state);
      } else {
        return (input: MultiStepInput) => inputClientSecret(input, state);
      }

      // await cp.execFile(workspacePath + "\\WindowsCredentialManager.exe",
      //   ["Get-Credentials", state.organisationUrl || '', "username"],
      //   async (error, stdout) => {
      //     if (error) {
      //       return getApplicationId(input, state);
      //     } else {
      //       if (stdout === '') {
      //         state.applicationId = await input.showInputBox({
      //           ignoreFocusOut: true,
      //           title,
      //           step: 2,
      //           totalSteps: 5,
      //           value: state.applicationId || '',
      //           prompt: 'Type in the Application ID',
      //           validate: validateNameIsUnique,
      //           shouldResume: shouldResume
      //         });
      //         return (input: MultiStepInput) => inputClientSecret(input, state);
      //       } else {
      //         return (input: MultiStepInput) => inputClientSecret(input, state);
      //       }
      //     }
      //   }
      // );

      // state.applicationId = await input.showInputBox({
      //   ignoreFocusOut: true,
      //   title,
      //   step: 2,
      //   totalSteps: 5,
      //   value: state.applicationId || '',
      //   prompt: 'Type in the Application ID',
      //   validate: validateNameIsUnique,
      //   shouldResume: shouldResume
      // });
      // return (input: MultiStepInput) => inputClientSecret(input, state);
    }
  }

  async function inputClientSecret(input: MultiStepInput, state: Partial<State>) {
    if (vscode.workspace.workspaceFolders !== undefined) {
      const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const util = require('util');
      const execSync = require("child_process").execSync;
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates"));
      let command = "\"" + fullFilePath + "\\WindowsCredentialManager.exe\" Get-Credentials " + state.organisationUrl || '';
      command += ' username';
      const result = execSync(command);
      const credentialResult = result.toString("utf-8");
      if (credentialResult === '') {
        state.createCredential = true;
        state.clientSecret = await input.showInputBox({
          ignoreFocusOut: true,
          title,
          step: 3,
          totalSteps: 5,
          value: state.clientSecret || '',
          prompt: 'Type in the Client Secret',
          validate: validateNameIsUnique,
          shouldResume: shouldResume
        });
        return (input: MultiStepInput) => inputSolutionName(input, state);
      } else {
        return (input: MultiStepInput) => inputSolutionName(input, state);
      }
    }
  }

  async function inputSolutionName(input: MultiStepInput, state: Partial<State>) {
    state.solutionName = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 4,
      totalSteps: 5,
      value: state.solutionName || '',
      prompt: 'What is the schema name of the solution?',
      validate: validateNameIsUnique,
      shouldResume: shouldResume
    });
    return (input: MultiStepInput) => inputPrefix(input, state);
  }

  async function inputPrefix(input: MultiStepInput, state: Partial<State>) {
    state.prefix = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 5,
      totalSteps: 5,
      value: state.prefix || '',
      prompt: 'What is the solution prefix? This is also used as the namespace and library.js prefix.',
      validate: validateNameIsUnique,
      shouldResume: shouldResume
    });
  }



  function shouldResume() {
    // Could show a notification with the option to resume.
    return new Promise<boolean>((resolve, reject) => {
      // noop
    });
  }

  async function validateNameIsUnique(name: string) {
    // ...validate...
    await new Promise(resolve => setTimeout(resolve, 1000));
    return name === 'vscode' ? 'Name not unique' : undefined;
  }

  const state = await collectInputs();

  if (vscode.workspace.workspaceFolders !== undefined) {
    const wsedit = new vscode.WorkspaceEdit();

    const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const filePath = vscode.Uri.file(folderPath + '/connectionstring2.txt');
    vscode.window.showInformationMessage(filePath.toString());
    //wsedit.createFile(filePath);
    //vscode.workspace.applyEdit(wsedit);
    let connectionString = 'AuthType=ClientSecret;LoginPrompt=Never;Url=';
    let credentialManagerString = '';
    connectionString += state.organisationUrl + ";";
    if (state.createCredential) {
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates"));
      await cp.execFile(fullFilePath + "\\WindowsCredentialManager.exe",
        ["New-Credential", state.organisationUrl || '', state.applicationId, state.clientSecret],
        async (error, stdout) => {
          if (error) {
          } else {
          }
        }
      );
      connectionString += 'ClientId=';
      connectionString += state.applicationId += ';ClientSecret=';
      connectionString += state.clientSecret;
    } else {
      credentialManagerString += context.getCredentialsFromManager(context, state.organisationUrl);
      connectionString += credentialManagerString;
    }

    context.projectSettings.prefix = state.prefix;
    context.projectSettings.solutionName = state.solutionName;
    context.projectSettings.connectionString = connectionString;
    // vscode.workspace.fs.writeFile(filePath, encodedString);
  }
  // window.showInformationMessage(`Creating Application Service '${state.name}'`);
}

export async function getProjectType(context: DataversePowerToolsContext) {
  const result = await window.showQuickPick(
    [
      { label: 'Plugins', description: 'Plugins', target: ProjectTypes.plugin },
      { label: 'Web Resources', description: 'Web Resources', target: ProjectTypes.webresource },
      { label: 'PCF Field', description: 'PCF Field', target: ProjectTypes.pcffield },
      { label: 'PCF Data Set', description: 'PCF Data Set', target: ProjectTypes.pcfdataset },
      { label: 'Solution', description: 'Solution', target: ProjectTypes.solution }
    ],
    { placeHolder: 'Select a Project Type.' }
  );
  context.projectSettings.type = result?.target;
  window.showInformationMessage(`Project Type: ${result?.label}`);
}

export async function getSolutionName(context: DataversePowerToolsContext) {
  const result = await window.showInputBox({
    ignoreFocusOut: true,
    prompt: 'Type in the Solution Name'
  });
  context.projectSettings.solutionName = result;
  window.showInformationMessage(`Solution: ${result}`);
}

class InputFlowAction {
  static back = new InputFlowAction();
  static cancel = new InputFlowAction();
  static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends QuickPickItem> {
  title: string;
  step: number;
  totalSteps: number;
  items: T[];
  activeItem?: T;
  placeholder: string;
  buttons?: QuickInputButton[];
  shouldResume: () => Thenable<boolean>;
}

interface InputBoxParameters {
  title: string;
  step: number;
  totalSteps: number;
  value: string;
  prompt: string;
  validate: (value: string) => Promise<string | undefined>;
  buttons?: QuickInputButton[];
  shouldResume: () => Thenable<boolean>;
}

class MultiStepInput {

  static async run<T>(start: InputStep) {
    const input = new MultiStepInput();
    return input.stepThrough(start);
  }

  private current?: QuickInput;
  private steps: InputStep[] = [];

  private async stepThrough<T>(start: InputStep) {
    let step: InputStep | void = start;
    while (step) {
      this.steps.push(step);
      if (this.current) {
        this.current.enabled = false;
        this.current.busy = true;
      }
      try {
        step = await step(this);
      } catch (err) {
        if (err === InputFlowAction.back) {
          this.steps.pop();
          step = this.steps.pop();
        } else if (err === InputFlowAction.resume) {
          step = this.steps.pop();
        } else if (err === InputFlowAction.cancel) {
          step = undefined;
        } else {
          throw err;
        }
      }
    }
    if (this.current) {
      this.current.dispose();
    }
  }

  async showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItem, placeholder, buttons, shouldResume }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
        const input = window.createQuickPick<T>();
        input.ignoreFocusOut = true;
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.placeholder = placeholder;
        input.items = items;
        if (activeItem) {
          input.activeItems = [activeItem];
        }
        input.buttons = [
          ...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
          ...(buttons || [])
        ];
        disposables.push(
          input.onDidTriggerButton(item => {
            if (item === QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            } else {
              resolve(<any>item);
            }
          }),
          input.onDidChangeSelection(items => resolve(items[0])),
          input.onDidHide(() => {
            (async () => {
              reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
            })()
              .catch(reject);
          })
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }

  async showInputBox<P extends InputBoxParameters>({ title, step, totalSteps, value, prompt, validate, buttons, shouldResume }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<string | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
        const input = window.createInputBox();
        input.ignoreFocusOut = true;
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.value = value || '';
        input.prompt = prompt;
        input.buttons = [
          ...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
          ...(buttons || [])
        ];
        let validating = validate('');
        disposables.push(
          input.onDidTriggerButton(item => {
            if (item === QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            } else {
              resolve(<any>item);
            }
          }),
          input.onDidAccept(async () => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;
            if (!(await validate(value))) {
              resolve(value);
            }
            input.enabled = true;
            input.busy = false;
          }),
          input.onDidChangeValue(async text => {
            const current = validate(text);
            validating = current;
            const validationMessage = await current;
            if (current === validating) {
              input.validationMessage = validationMessage;
            }
          }),
          input.onDidHide(() => {
            (async () => {
              reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
            })()
              .catch(reject);
          })
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }
}