# Change Log

All notable changes to the "dataverse-powertools" extension will be documented in this file.

## 0.3.2

- Added plugin unit testing support, including setup, test class generation, and test execution commands.
- Added test framework selection support for MSTest, xUnit, and NUnit.
- Fixed CodeLens filtering attribute updates to resolve the correct decoration/table context.
- Added plugin project naming during initialization and improved foldered project layout handling.
- Improved plugin v3 solution creation.
- Hardened plugin/test compatibility for generated test projects (target framework and C# language version normalization).
- Fixed package/deploy artifact discovery for nested project outputs and excluded test packages from deployment selection.

## 0.3.1

- Added support for plugin and workflow class decorations using codelens with ability to select and update filtering attirbutes through command bar prompt.
- Added package upsert to dataverse including assembly, steps and workflow activity registration
- Added support for local building of plugin code.
- Removed spkl dependency for plugin projects. We still use the same class decoration styles for plugin and workflow activity registration but instead of spkl handling the deployment and registration we are now doing this directly through the dataverse API.
- Now using the pac plugin init command to create plugin projects.  This will ensure that the project is set up correctly for use with the dataverse powertools extension and will also allow for better compatibility with future updates to the extension. N: This is a breaking change as it will change the structure of the plugin projects created by the extension.  Existing plugin projects will need to be updated to match the new structure in order to use the new features of the extension.  This will involve creating a new project using the extension and then copying over the existing code and configuration files from the old project to the new project. Old plugin projects will still be deployable using the old method, but will not be able to take advantage of the new features until they are updated to the new structure.
- Added some more logging to help with troubleshooting and to provide more visibility into the deployment process.
- Plugins now use packages instead of direct assembly deployment.  This will allow for dependant assemblies to be included in the deployment and will also allow for better management of plugin versions and dependencies.
- Added configurable plugin package version support via `dataverse-powertools.json` (`pluginPackageVersion`) and now publish all customizations after plugin package/step/workflow deployment.
- Updates Portal project type to use latest pac commands.
- Removed pcffield and pcfdataset project types.  These project types were not working and we are currently rebuilding the functionality for these project types to be included in a future release.

## 0.3.0

- Removed reliance on spkl for webresource deployment.  Webresources are now deployed using direct Dataverse API calls. This release also includes a migration command to help move from spkl to the new deployment method.
- Improved experience for extenstion startup and loading.  The extension will now load much faster and will only load the components that are needed for the current project type.  This will also allow for better error handling and logging during the startup process.
- System requirements check.  The extension will now check for the required system requirements on startup and will provide a warning if any of the requirements are not met.  This will help to prevent issues with the extension not working correctly due to missing dependencies or unsupported environments.
- Dependabot updates.  Updated all dependencies to their latest versions to ensure that the extension is using the most up-to-date and secure versions of its dependencies.
- Applied Github Security and CodeQL recommendations to improve security and code quality of the extension.

## 0.2.2

Updated word-wrap as recommended by dependecybot in GitHib.

## 0.2.1

Updated fast-xml-parser to remove vulnerablity to Regex Injection via Doctype Entities as per <https://github.com/advisories/GHSA-6w63-h3fj-q4vw>

## 0.2.0

- Added form intercepts to the Dataverse PowerTools menu.  This will allow you to select the forms intercepts for XrmDefinatelyTyped to generate into classes from the menu rather than manually.This release includes the ability to select any available form from your dataverse environment. Note there is still no support for view intercepts. This will be added in a future release.
- Added support to include XRMQuery into the library bundle. This will save having to load XRMQuery onto the form in addition to the library file.
- Some better error handling
- Rebuilt how the extension loads to be more modular.

## 0.1.13

- Added lookup to dataverse to get form list to save having to enter the form id into the vscode dialog.
- Reworked the dataverse context. This is now a singleton class that is created when the extension is activated.  This will allow the context to be used by other parts of the extension. This will prevent the need for multiple requests to get auth tokens and will handle refreshing the token automatically.
- Added some more logging.

## 0.1.12

Added support to register form events for webresource classes.  This will allow you to register form events for webresources in the same way as you can for plugin steps.  To use this feature you need to select Add Form Registration when in a webresource class.  This will add a new property to the class called FormRegistration.  This property is a list of FormRegistration objects.  Each FormRegistration object has the following properties:

formId - The form id to register the event for.  This can be found in the form url in the maker portal.
event - The event to register for.  This can be one of the following value: onload, onsave.
excutionContext - Specifices whether to send the execution context to the webresource.  This can be one of the following values: true, false.
triggerId - The id of the event registration. Must be a unique GUID
function - The name of the function to call in the webresource.

Once you are ready to publish the events to dataverse you can use the Register Form Events command in the Dataverse PowerTools menu.  This will publish the events to dataverse and add the event registrations to the form.

## 0.1.11

Miscellaneous bug fixes.

## 0.1.10

- Added Earlybound Table and Action GUI to the Dataverse PowerTools menu.  This will allow you to select the tables and actions for spkl to generate into classes from the menu rather than editing the spkl.json manually.  This release includes the ability to select any available table from your dataverse environment, future releases will also allow this for actions. Currently action selection is limited to using the manual + button.
