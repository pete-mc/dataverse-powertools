# Change Log

All notable changes to the "dataverse-powertools" extension will be documented in this file.

## 0.5.4

- New: **Debug Web Resources** — run your local webpack bundle _inside the live model-driven app_ with hot reload and VS Code debugging, instead of republishing on every change. A dedicated Edge/Chrome instance is launched under the DevTools Protocol and its request for the deployed bundle is fulfilled from your local `bin/` build; `webpack --watch` rebuilds on save and the form reloads, and the JS debugger attaches for breakpoints. Nothing is written to Dataverse — the swap is ephemeral and browser-scoped (#64).
- Fixed Debug Web Resources not taking effect on real forms: model-driven apps serve web resources from a service-worker cache above the network layer, so interception now bypasses that service worker to ensure the live form runs your local code.
- Security: resolved CodeQL findings in existing code — reworked two ReDoS-prone regexes, spawn a constant `cmd.exe` instead of an environment-provided one, and validate/sanitize the organization URL and plugin project name before they are passed to external tools. No behaviour change for valid input.

## 0.5.3

- Testing: unit-tested the Dataverse Web API layer (table / form / message / attribute / solution fetchers) — URL construction, response parsing, and error handling — and added a coverage threshold that CI now enforces as a regression gate (#80).
- Internal: removed the now-redundant per-file `toApiUrl` wrappers so all Dataverse Web API calls go through the single `dataverseApiUrl` helper directly — one API-version source of truth (finishes #77). No behaviour change.

## 0.5.2

- Fixed early-bound generation failing with `spawn EINVAL`: on Windows `pac` is a `.cmd` shim that recent Node versions refuse to spawn directly, so all `pac` calls (early-bound/model builder, portals, solutions) now run through `cmd.exe /c pac …`.
- Fixed plugin deploy failing with `spawn pwsh ENOENT`: the plugin package is now sanitized (forbidden SDK assemblies stripped) with an in-process zip library instead of shelling out to PowerShell, so it no longer requires PowerShell Core and works cross-platform.
- Fixed new Web Resources projects failing to create with an `npm ERESOLVE` error — TypeScript is now pinned to v5 (a bare install resolved to TypeScript 7, which conflicts with the ESLint TypeScript plugin's peer range).
- Fixed the early-bound side panel showing "error loading" until VS Code was reloaded after creating a project — the tree view provider is now registered immediately on project creation.
- Fixed typings generation failing with `XrmDefinitelyTyped.exe ENOENT`: new Web Resources projects now restore the `Delegate.XrmDefinitelyTyped` tool via paket (the restore step had been missing from the template), and the command now reports a clear, actionable error if the tool still isn't present.
- Fixed service-principal projects failing to reconnect on load ("Dataverse Not Connected", "Error refreshing authorization token", and broken typings): when reassembling the connection string from the stored settings and the secret-storage credentials, the client id was glued onto the URL with no separator (`Url=<url>ClientId=…`). The parts are now merged through the shared connection-string builder so the separators are always correct.
- Fixed a new Web Resources project not building cleanly out of the box: the scaffolded `webresources_src/library.ts` re-exported a non-existent `./account` module. It is now an empty stub that `Create Web Resource Class` appends each new class to.
- Fixed the webpack build of a fresh Web Resources project failing on the scaffolded sample files: `class.ts` and `sample.test.ts` were copied in with unreplaced placeholders (`Form.TableName.Main.FormName`, `import '../ClassName'`), which ts-loader type-checked and rejected. They are templates for the Create Class/Test commands, not scaffold files, so a new project no longer ships them.

## 0.5.1

- Fixed new plugin-package creation, which failed on Dataverse's `204 No Content` response — the id is now read from the `OData-EntityId` header instead of parsing an empty body.
- Centralised all Dataverse Web API calls through a single URL/version helper so requests no longer target mixed API versions; fixed the organisation URL used by form registration and the connection-string parsing in typings generation (#77).
- Replaced hard-coded `\\` path separators in template generation with `path.join`, fixing webresource/template scaffolding off-Windows (#73).
- Portal commands now parse the `pac` CLI table by anchoring on its column headers instead of whitespace/index scraping, so an environment display name (or any spaced value) and pac column-width changes no longer break website selection (#75).
- Dataverse HTTP errors are now surfaced consistently — every list/register/form call logs the operation, status, and response body (and one form-listing call that silently swallowed failures now reports them) (#76).
- Added success logging when webresources and plugin packages are pushed, so the output channel confirms what was created/updated/deployed (#76).
- Testing: added an opt-in live end-to-end tier (form decoration, solution pack/unpack/export via `pac`, plugin scaffold + `dotnet build` + package push) that self-skips without credentials, expanded the ExTester UI coverage, and hardened overlay handling in UI/screenshot runs (#65, #80).

## 0.5.0

- Added interactive Dataverse sign-in (MSAL loopback public-client flow using Microsoft's well-known Dataverse sample app id — no app registration required): sign in once, pick your environment from a Global Discovery list, pick a solution (publisher prefix inferred), with a branded loopback success/error page (#62).
- Service-principal (client secret) auth is now credentials-first with the same environment picker.
- Token cache is persisted to VS Code secret storage; the extension connects silently on load and re-authenticates on genuine expiry without re-entering environment/solution details.
- Added a "Switch Dataverse Environment" command (change environments without re-entering credentials) and a "Refresh Connection" command; renamed the connection command to "Update Dataverse Authentication".
- Status bar item now shows a `$(database)` icon so the connection reads as Dataverse PowerTools.
- Dropped certificate auth (a back-end/CI pattern, not an interactive-coding path).
- Fixed the generated webresource class template: form registration now matches the `OnLoad` function, the library global uses the solution prefix, and the form name is handled correctly (#70).

## 0.4.0

- Migrated solution commands from `spkl.exe` to the Power Platform CLI (`pac`), so extract/pack/deploy run on Windows, macOS, and Linux; removed hard-coded Windows path separators that broke settings I/O off-Windows (`spkl` now only remains in the deprecated `plugins_old` path).
- Fixed token auto-refresh dying ~1h into a session (client-credentials was using a `refresh_token` grant that always failed).
- `npm ls -g` output is now parsed even on non-zero exit, so installed globals aren't reported as missing.
- Webresource build/deploy is now awaited and gated on the build result (was detached), with corrected ANSI stripping and a narrower error match.
- Publish operations now check `response.ok` and log failures instead of swallowing them; added shared, unit-tested connection-string and path helpers.
- Added a test foundation (unit / integration / UI layers plus an opt-in live tier) with a CI gate — publishing to the Marketplace is now gated on lint + compile + unit + integration passing.
- Rewrote the README as a concise Marketplace store page with real UI screenshots, and rebuilt the wiki to match the current feature set.

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
