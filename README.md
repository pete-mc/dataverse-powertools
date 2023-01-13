# dataverse-powertools README

Dataverse Powertools contains tools and templates to help with the development of Dataverse and Dynamics 365 projects.

## Web Resources

### Development
Code is in .ts files

Located in the src files

Code will auto populate with the attributes/views etc.

### Building and Deployment
1. Task Explorer - vscode -> build-deploy dev to build the dev file and deploy it into the dev environment
2. The file will end up called cld_library.js. In the DEV version, it will contain the code that will allow debugging as the .ts file
3. In Dynamics, add in the library.js file. Each function will be called by prefix.Class.FunctionName. Pass execution context.

