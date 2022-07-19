import { TextEncoder } from "util";
import * as vscode from "vscode";
import { QuickPickItem, window, Disposable, CancellationToken, QuickInputButton, QuickInput, ExtensionContext, QuickInputButtons, Range, TextEdit } from 'vscode';
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function createConnectionString(context: DataversePowerToolsContext) {
  interface State {
    title: string;
    step: number;
    organisationUrl: string;
    applicationId: string;
    totalSteps: number;
    name: string;
    clientSecret: string;
  }

  const title = 'Creating the Credentials';

  async function collectInputs() {
    const state = {} as Partial<State>;
    await MultiStepInput.run(input => inputURL(input, state));
    return state as State;
  }

  async function inputURL(input: MultiStepInput, state: Partial<State>) {
		state.organisationUrl = await input.showInputBox({
			title,
			step: 1,
			totalSteps: 3,
			value: typeof state.organisationUrl === 'string' ? state.organisationUrl : '',
			prompt: 'Type in the Organisation URl',
			validate: validateNameIsUnique,
			shouldResume: shouldResume
		});
    return (input: MultiStepInput) => inputApplicationId(input, state);
	}

	async function inputApplicationId(input: MultiStepInput, state: Partial<State>) {
		state.applicationId = await input.showInputBox({
			title,
			step: 2,
			totalSteps: 3,
			value: state.applicationId || '',
			prompt: 'Type in the Application ID',
			validate: validateNameIsUnique,
			shouldResume: shouldResume
		});
    return (input: MultiStepInput) => inputClientSecret(input, state);
	}

  async function inputClientSecret(input: MultiStepInput, state: Partial<State>) {
		state.clientSecret = await input.showInputBox({
			title,
			step: 3,
			totalSteps: 3,
			value: state.clientSecret || '',
			prompt: 'Type in the Client Secret',
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
    let connectionString = 'AuthType=ClientSecret;Url=';
    connectionString += state.organisationUrl += ';ClientId=';
    connectionString += state.applicationId += ';ClientSecret=';
    connectionString += state.clientSecret += ';LoginPrompt=Never';
    const encoder = new TextEncoder();
    const encodedString = encoder.encode(connectionString);
		context.projectSettings.connectionString = connectionString;
    // vscode.workspace.fs.writeFile(filePath, encodedString);
  }
	// window.showInformationMessage(`Creating Application Service '${state.name}'`);
}

export async function getSolutionName(context: DataversePowerToolsContext) {
	const result = await window.showInputBox({ 
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