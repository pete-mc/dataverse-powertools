import fetch from 'node-fetch';
import { window} from 'vscode';
import DataversePowerToolsContext, { ProjectTypes } from "../context";
import { MultiStepInput } from './inputControls';

export async function updateConnectionString(context: DataversePowerToolsContext){
  let connectionString = await createServicePrincipalString(context, true);
  await context.writeSettings();
  await context.readSettings(context);
  context.statusBar.text = connectionString.split(';')[2].replace('Url=', '') ?? "";
  context.statusBar.show();
}

export async function getServicePrincipalString(context: DataversePowerToolsContext, name: string): Promise<string> {
  const servicePrincipal = await context.vscode.secrets.get(name);
  return servicePrincipal === undefined ? "" : servicePrincipal; 
}

export async function saveServicePrincipalString(context: DataversePowerToolsContext, name: string, clientId: string, clientSecret: string): Promise<void> {
  const value = "ClientId=" + clientId + ";" + "ClientSecret=" + clientSecret + ";";
  await context.vscode.secrets.store(name,value);
  context.channel.appendLine("Settings Saved!");
}

export async function createServicePrincipalString(context: DataversePowerToolsContext, update?: boolean): Promise<string>{
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
    let organisationUrl = '';
    if (state.organisationUrl !== undefined && state.organisationUrl !== '') {
      organisationUrl = state.organisationUrl.replace(/\/+$/, '');
    }
    const credentialResult = await context.vscode.secrets.get(organisationUrl);
    if (credentialResult === undefined || !context.projectSettings.tenantId || update) {
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
    else {
      state.tenantId = context.projectSettings.tenantId;
      state.applicationId = credentialResult.split(";")[0].replace("ClientId=","");
      state.clientSecret = credentialResult.split(";")[1].replace("ClientSecret=","");
      //if (state.solutionName) { return; };     
      return (input: MultiStepInput) => inputSolutionName(input, state);
    }
  }

  async function inputApplicationId(input: MultiStepInput, state: Partial<State>) {
    let organisationUrl = '';
    if (state.organisationUrl !== undefined && state.organisationUrl !== '') {
      organisationUrl = state.organisationUrl.replace(/\/+$/, '');
    }
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
    if (update) {return;}
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
    context.channel.appendLine("Error connecting to dataverse, reverting to manaul solution entry");
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
  return connectionString;
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
  switch (context.projectSettings.type) {
    case ProjectTypes.solution:
      context.projectSettings.templateversion  = 1.1;
      break;
  default:
      context.projectSettings.templateversion  = 1;
      break;
  }
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

