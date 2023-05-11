import fetch from 'node-fetch';
import { QuickPickItem, window, Disposable,  QuickInputButton, QuickInput,  QuickInputButtons, workspace} from 'vscode';
import DataversePowerToolsContext, { ProjectTypes } from "../context";


export async function getServicePrincipalString(context: DataversePowerToolsContext, name: string): Promise<string> {
  const servicePrincipal = await context.vscode.secrets.get(name);
  return servicePrincipal === undefined ? "" : servicePrincipal; 
}

export async function saveServicePrincipalString(context: DataversePowerToolsContext, name: string, clientId: string, clientSecret: string): Promise<void> {
  const value = "ClientId=" + clientId + ";" + "ClientSecret=" + clientSecret + ";";
  await context.vscode.secrets.store(name,value);
  context.channel.appendLine("Settings Saved!");
}

export async function createServicePrincipalString(context: DataversePowerToolsContext) {
  interface State {
    title: string;
    step: number;
    organisationUrl: string;
    tenantId: string;
    applicationId: string;
    totalSteps: number;
    name: string;
    clientSecret: string;
    solutionName: string;
    prefix: string;
    controlName: string;
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
      totalSteps: 6,
      value: typeof state.organisationUrl === 'string' ? state.organisationUrl.replace(/\/+$/, '') : '',
      prompt: 'Type in the Organisation URl',
      validate: validateNameIsUnique,
      shouldResume: shouldResume,
    });
    return (input: MultiStepInput) => inputTenantId(input, state);
  }

  async function inputTenantId(input: MultiStepInput, state: Partial<State>) {
    state.tenantId = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 2,
      totalSteps: 6,
      value: typeof state.tenantId === 'string' ? state.tenantId.replace(/\/+$/, '') : '',
      prompt: 'Type in the Tenant Id',
      validate: validateNameIsUnique,
      shouldResume: shouldResume,
    });
    return (input: MultiStepInput) => inputApplicationId(input, state);
  }

  async function inputApplicationId(input: MultiStepInput, state: Partial<State>) {
    let organisationUrl = '';
    if (state.organisationUrl !== undefined && state.organisationUrl !== '') {
      organisationUrl = state.organisationUrl.replace(/\/+$/, '');
    }
    const credentialResult = await context.vscode.secrets.get(organisationUrl);
    if (credentialResult === undefined) {
      state.createCredential = true;
      state.applicationId = await input.showInputBox({
        ignoreFocusOut: true,
        title,
        step: 3,
        totalSteps: 6,
        value: state.applicationId || '',
        prompt: 'Type in the Application ID',
        validate: validateNameIsUnique,
        shouldResume: shouldResume
      });
      return (input: MultiStepInput) => inputClientSecret(input, state);
    } else {
      state.applicationId = credentialResult.split(";")[0].replace("ClientId=","");
      state.clientSecret = credentialResult.split(";")[1].replace("ClientSecret=","");
      
      return (input: MultiStepInput) => inputSolutionName(input, state);
    }
  }

  async function inputClientSecret(input: MultiStepInput, state: Partial<State>) {
        state.clientSecret = await input.showInputBox({
          ignoreFocusOut: true,
          title,
          step: 4,
          totalSteps: 6,
          value: state.clientSecret || '',
          prompt: 'Type in the Client Secret',
          validate: validateNameIsUnique,
          shouldResume: shouldResume
        });
        return (input: MultiStepInput) => inputSolutionName(input, state);
  }

  async function inputSolutionName(input: MultiStepInput, state: Partial<State>) {
    try {
    const tokenUrl = 'https://login.microsoftonline.com/' + state.tenantId +'/oauth2/token';
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', state.applicationId || '');
    params.append('client_secret', state.clientSecret || '');
    params.append('resource', state.organisationUrl || '');
    
    const tokenRequestBody: any = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'grant_type': 'client_credentials',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'client_id': state.applicationId || '',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'client_secret': state.clientSecret || '',
      'resource': state.organisationUrl || '',
    };

    let formBody = [];
    for (var property in tokenRequestBody) {
      var encodedKey = encodeURIComponent(property);
      var encodedValue = encodeURIComponent(tokenRequestBody[property]);
      formBody.push(encodedKey + "=" + encodedValue);
    }
    const formBodyString = formBody.join("&");

    const tokenResponse = await fetch(tokenUrl, {
      method: 'post',
      body: formBodyString,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}
    });

    const data: any = await tokenResponse.json();

    if (data !== null && data['access_token'] !== null) {
      const options = {
        'method': 'GET',
        'headers': {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Authorization': 'Bearer ' + data['access_token']
        }
      };
      const response = await fetch(state.organisationUrl + '/api/data/v9.0/solutions', options);
      const body: any = await response.json();
      if (body !== null && body['value'] !== null) {
        let arrayOfSolutions = body['value'];
        arrayOfSolutions = arrayOfSolutions.filter((x: any) => x['ismanaged'] === false).sort((a: any, b: any) => (a['uniquename'] > b['uniquename']) ? 1 : -1);
        let quickPickArray = [];
        for (const solution of arrayOfSolutions) {
          quickPickArray.push({ label: solution['uniquename'], target: solution['uniquename'] });
        }
        const result = await window.showQuickPick(
          quickPickArray,
          { placeHolder: 'Select a CRM/Dynamics Solution.' }
        );
        state.solutionName = result?.target;
        var selectedSolution = arrayOfSolutions.find((x: any) => x['uniquename'] === state.solutionName);
        if (selectedSolution !== null) {
          const publisherId = selectedSolution['_publisherid_value'];
          const publishserResponse = await fetch(state.organisationUrl + '/api/data/v9.0/publishers', options);
          const publisherBody: any = await publishserResponse.json();
          if (publisherBody['value'] !== null) {
            const publisher = publisherBody['value'].find((x: any) => x['publisherid'] === publisherId);
            state.prefix = publisher['customizationprefix'];
          } 
        }
        window.showInformationMessage(`Solution Selected: ${result?.label}`);
        if (context.projectSettings.type === ProjectTypes.pcfdataset) {
          return (input: MultiStepInput) => inputControlName(input, state);
        }
      } else {
        state.solutionName = await input.showInputBox({
          ignoreFocusOut: true,
          title,
          step: 5,
          totalSteps: 6,
          value: state.solutionName || '',
          prompt: 'What is the schema name of the solution?',
          validate: validateNameIsUnique,
          shouldResume: shouldResume
        });
      }
    } else {
      state.solutionName = await input.showInputBox({
        ignoreFocusOut: true,
        title,
        step: 5,
        totalSteps: 6,
        value: state.solutionName || '',
        prompt: 'What is the schema name of the solution?',
        validate: validateNameIsUnique,
        shouldResume: shouldResume
      });
    }
  }
  catch{
    context.channel.appendLine("Error connecting to dataverse, reverting to manaul solution entry")
    state.solutionName = await input.showInputBox({
      ignoreFocusOut: true,
      title,
      step: 5,
      totalSteps: 6,
      value: state.solutionName || '',
      prompt: 'What is the schema name of the solution?',
      validate: validateNameIsUnique,
      shouldResume: shouldResume
    });
  }
    return (input: MultiStepInput) => inputPrefix(input, state);
  }

  async function inputPrefix(input: MultiStepInput, state: Partial<State>) {
    if (state.prefix === null || state.prefix === '') {
      state.prefix = await input.showInputBox({
        ignoreFocusOut: true,
        title,
        step: 6,
        totalSteps: 6,
        value: state.prefix || '',
        prompt: 'What is the solution prefix? This is also used as the namespace and library.js prefix.',
        validate: validateNameIsUnique,
        shouldResume: shouldResume
      });
    }
  }

  async function inputControlName(input: MultiStepInput, state: Partial<State>) {
    if (state.controlName === null || state.controlName === '') {
      state.controlName = await input.showInputBox({
        ignoreFocusOut: true,
        title,
        step: 7,
        totalSteps: 7,
        value: state.controlName || '',
        prompt: 'What is the control name of this PCF Control?',
        validate: validateNameIsUnique,
        shouldResume: shouldResume
      });
    }
  }



  function shouldResume() {
    // Could show a notification with the option to resume.
    return new Promise<boolean>((_resolve, _reject) => {
      // noop
    });
  }

  async function validateNameIsUnique(name: string) {
    // ...validate...
    await new Promise(resolve => setTimeout(resolve, 1000));
    return name === 'vscode' ? 'Name not unique' : undefined;
  }

  const state = await collectInputs();
  let connectionString = 'AuthType=ClientSecret;LoginPrompt=Never;Url=';
  connectionString += state.organisationUrl + ";";
  context.connectionString = connectionString;
  if (state.createCredential) {
    await saveServicePrincipalString(context, state.organisationUrl, state.applicationId, state.clientSecret);
    connectionString += 'ClientId=';
    connectionString += state.applicationId += ';ClientSecret=';
    connectionString += state.clientSecret;
  } else {
    connectionString += await getServicePrincipalString(context, state.organisationUrl);
  }
  context.projectSettings.prefix = state.prefix;
  context.projectSettings.tenantId = state.tenantId;
  context.projectSettings.solutionName = state.solutionName;
  context.projectSettings.connectionString = connectionString;
  context.projectSettings.controlName = state.controlName;
}

export async function getProjectType(context: DataversePowerToolsContext) {
  const result = await window.showQuickPick(
    [
      { label: 'Plugins', description: 'Plugins', target: ProjectTypes.plugin },
      { label: 'Web Resources', description: 'Web Resources', target: ProjectTypes.webresource },
      { label: 'PCF Field', description: 'PCF Field', target: ProjectTypes.pcffield },
      { label: 'PCF Data Set', description: 'PCF Data Set', target: ProjectTypes.pcfdataset },
      { label: 'Solution', description: 'Solution', target: ProjectTypes.solution },
      { label: 'Portal', description: 'Portal', target: ProjectTypes.portal },
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

  static async run(start: InputStep) {
    const input = new MultiStepInput();
    return input.stepThrough(start);
  }

  private current?: QuickInput;
  private steps: InputStep[] = [];

  private async stepThrough(start: InputStep) {
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