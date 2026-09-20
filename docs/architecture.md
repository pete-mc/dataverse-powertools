# Architecture reference: Dataverse PowerTools

Reference material moved out of AGENTS.md. It describes the structure and intent of this VS Code extension. Rules and traps live in [AGENTS.md](../AGENTS.md).

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

Project types are defined by the `ProjectTypes` enum in `src/projectTypes/registry.ts` (re-exported from `src/context.ts`). The list below is the older documented set; the enum now also has `pcf` and `azurefunction` (check the registry before relying on this list):

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

## FetchXML query tools (`src/query`, #238)

Finds FetchXML **inside the user's own C#/TypeScript string literals** — there is no query file
type — then offers a CodeLens (Run / Edit in generator / issues), diagnostics with quick fixes, a
generator webview, and a results grid.

- Almost all of it is **pure and unit-tested**: `fetchXml.ts` (parse ⇄ serialize, faithful enough
  to write back into source), `literals/` (per-language string + `+`-chain tokenizers), `holes.ts`
  (interpolation ⇄ `@token` mapping), `consumers.ts`, `diagnostics.ts`, `parameters.ts`,
  `edits.ts`, `generatorState.ts`, `results.ts`, `metadata/cache.ts`.
- The model is **uniform** (`{ tag, attrs, children }`, nothing hoisted into typed fields) so an
  attribute the generator doesn't know about still round-trips instead of vanishing from the user's file.
- The generator webview is a **renderer only**: it posts edit INTENTS, the host applies them with
  `edits.ts` and posts fresh state back, so generator behaviour is testable without a browser.
- Write-back (`writeBack.ts`) re-reads the literal it is about to emit and **refuses** the write
  unless it decodes back identically; a no-op save never touches the file.
- Metadata is lazy and **session-scoped only** (`metadataService.ts`, keyed by organization URL) —
  deliberately not persisted, because users change metadata while using this.
- Commands + providers register ONCE in `extension.ts` (`registerQueryCommands`), never per
  component. Gated by the `fetchXmlQueries` preview feature.

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
