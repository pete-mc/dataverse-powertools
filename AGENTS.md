# AGENTS Guide: Dataverse PowerTools

This document helps coding agents understand the structure and intent of this VS Code extension.

## What this repo is

`dataverse-powertools` is a VS Code extension that accelerates Dataverse / Dynamics 365 development by:

- Scaffolding project templates
- Managing project settings and connection context
- Running build/deploy workflows for different project types
- Interacting with Dataverse APIs directly from extension commands

The extension is centered around a workspace-level config file: `dataverse-powertools.json`.

## Core architecture

- `src/extension.ts`: extension entrypoint (`activate`) and top-level initialization.
- `src/context.ts`: shared runtime context (`DataversePowerToolsContext`) with:
  - settings (`projectSettings`)
  - Dataverse auth/client (`context.dataverse`)
  - output/status UI handles
- `src/general/`: shared command and setup flow.
- `src/general/dataverse/`: Dataverse API helper classes and functions.
- `src/<type>/`: feature modules by project type:
  - `webresources/`
  - `plugins/`
  - `solution/`
  - `portals/`
- `templates/`: scaffold templates used when creating projects/files.

## Project types and feature modules

Project types are defined in `src/context.ts` (`ProjectTypes`):

- `plugin`
- `webresources`
- `pcffield`
- `pcfdataset`
- `solution`
- `portal`

Each type has:

- an initialization function that sets VS Code context keys
- a set of commands registered on activation
- template assets in `templates/<type>/`

Example: `src/webresources/initialiseWebresources.ts` sets:

- `dataverse-powertools.isWebResource = true`
- registers webresource-related commands

## Settings/context model

Primary settings file: `dataverse-powertools.json` in workspace root.

Common settings in `projectSettings` include:

- `type`
- `templateversion`
- `tenantId`
- `connectionString` (stored without secrets; secrets are in VS Code secret storage)
- `solutionName`
- `webresourceSolutionName` (used for webresource solution association)
- `prefix`

Secret handling:

- `connectionString` in settings is non-secret base.
- client secret/id are stored via VS Code secret store.
- merged runtime connection string is rebuilt at load time.

## Template system

Template metadata:

- `templates/<type>/template.json`

Each template entry can define:

- `files`: source template payloads to copy
- `restoreCommands` / `initCommands`: dependency/bootstrap commands
- placeholders replaced during generation

Key behavior:

- generation is managed by `src/general/generateTemplates.ts`
- placeholders are replaced in file content and destination paths
- generated project settings are persisted to `dataverse-powertools.json`

## Dataverse API helpers

- `DataverseContext` (`src/general/dataverse/dataverseContext.ts`):
  - token acquisition/refresh
  - base organization URL
  - publish operations
- `DataverseForm`:
  - load/update form XML
- `DataverseWebresource`:
  - lookup/create/update webresources
  - add webresource component to a solution (`AddSolutionComponent`)

Guideline: keep raw Dataverse HTTP calls in `src/general/dataverse/` helper classes instead of feature command files.

## Webresources flow (current)

Main command path:

- build artifacts to `bin/`
- deploy command scans `bin/**`
- each file is upserted as a Dataverse webresource
- if `webresourceSolutionName` (or fallback `solutionName`) exists, webresource is added to that solution
- customizations are published

## SPKL migration notes

Webresources no longer require SPKL for deploy.

Migration command:

- `Dataverse PowerTools: Upgrade from Spkl`
- visible for webresource projects when `spkl.json` exists
- extracts solution name from `spkl.json`
- writes it to `dataverse-powertools.json` (`webresourceSolutionName`)
- removes `spkl.json`
- refreshes in-memory context

Context key used for UI visibility:

- `dataverse-powertools.hasSpkl`

## Command/UI wiring

`package.json` contributes:

- commands
- menu/view entries
- `when` conditions bound to context keys (`showLoaded`, `isWebResource`, etc.)

Initialization modules are responsible for setting context keys via `vscode.commands.executeCommand("setContext", ...)`.

## Extension settings (`contributes.configuration`)

User-level VS Code settings, distinct from the per-workspace `dataverse-powertools.json`. They
are read through `src/general/extensionConfig.ts` — no string-literal setting ids elsewhere:

- `dataverse-powertools.previewFeatures` (default `false`) — show features that have not
  finished manual testing. The gated list lives in `src/general/previewFeatures.ts` (pure) and
  is enforced against `package.json` by `previewFeatures.spec.ts`. Toggleable from the panel
  footer checkbox.
- `dataverse-powertools.collapseCardsFrom` (default `3`) — component count at which panel cards
  start collapsed; per-card expand/collapse overrides still win and persist in `layout.collapsedCards`.
- `dataverse-powertools.copilot.accessMode`, `dataverse-powertools.debugBrowser`,
  `dataverse-powertools.debugBrowserPath`.

## Practical guidance for coding agents

When making changes:

1. Keep project-type logic in its module (`src/webresources`, `src/plugins`, etc.).
2. Put Dataverse HTTP/API behavior in `src/general/dataverse/`.
3. Persist new workspace settings in `projectSettings` and `dataverse-powertools.json`.
4. If adding commands, update both:
   - registration in initialization code
   - contributions in `package.json` (command + visibility rules)
5. If templates change, update `templates/<type>/template.json` and payload files together.
6. Validate with:
   - `npm run lint`
   - `npm run compile`

## Common pitfalls

- Avoid storing secrets in `dataverse-powertools.json`.
- Keep `when` expressions in `package.json` aligned with runtime context keys.
- Don’t scatter Dataverse fetch calls across feature files; centralize helper classes.
- Template metadata and file tree must stay in sync (no stale entries).
- **Support both auth types.** A connection is service-principal *or* interactive (OAuth); the
  latter has **no tenantId**. Gate Dataverse commands on the live connection
  (`canCallDataverseApi` in `src/general/dataverse/connectionReady.ts`), never on a tenantId.
- **Run the project's local tool bins via `npx`** (webpack, jest) — a bare `webpack`/`jest`
  needs a global install. The webresource build uses `tsconfig.build.json` (types `[]`, tests
  excluded) so it needn't type-check tests or resolve `@types/jest`. `dotnet` spawns directly;
  `.cmd` shims (npx/pac) go through `cmd.exe` (see `src/general/pac.ts`).
- **Testing:** prefer extracting pure, `vscode`-free logic into a module with a co-located
  `.spec.ts` (e.g. `pacArgs`, `buildTypingsArgs`, `connectionReady`, the Test-Explorer parsers
  `parseTrx`/`parseDotnetListTests`/`parseJestJson`). The interactive-auth path is only covered
  by the `*InteractiveLifecycle` e2e suites — see [TESTING.md](TESTING.md) for how they're
  seeded and run.

## Typings + Test Explorer (recent)

- **Webresource typings** are generated by a bundled **net8** XrmDefinitelyTyped (`dotnet`,
  `tools/xrmdefinitelytyped/`), token-authenticated via `DVPT_TOKEN` — cross-platform, both auth
  types, no `.exe`/paket. Arg builders in `src/webresources/generateTypings.ts`.
- **Native Test Explorer** (`vscode.tests`): a `TestController` per project type created in the
  feature `initialise*` (`pluginTestController.ts`, `webresourceTestController.ts`). Plugins run
  `dotnet test --logger trx`; web resources run local `npx jest --json`. Result/discovery parsing
  lives in pure, unit-tested modules — keep it there, not in the controllers.
