# Contributing to Dataverse PowerTools

Thanks for contributing to `dataverse-powertools`.

## What this extension does

This VS Code extension streamlines Dataverse / Dynamics 365 development by:

- Generating project templates
- Managing workspace-level settings and Dataverse connection context
- Running build/deploy workflows for multiple project types
- Executing Dataverse API operations from commands

Primary workspace config lives in `dataverse-powertools.json`.

## Project layout

- `src/extension.ts`: extension activation and startup flow.
- `src/context.ts`: shared runtime context, settings, and Dataverse client state.
- `src/general/`: shared setup utilities and command helpers.
- `src/general/dataverse/`: Dataverse API helper classes (preferred location for raw API calls).
- `src/webresources/`, `src/plugins/`, `src/solution/`, `src/portals/`: feature modules by project type.
- `templates/`: scaffold source files and metadata.

## Project types

Defined in `src/context.ts`:

- `plugin`
- `webresources`
- `pcffield`
- `pcfdataset`
- `solution`
- `portal`

Each type typically includes:

- an initializer that sets VS Code context keys
- command registrations
- matching template assets under `templates/<type>/`

## Development guidelines

1. Keep project-type logic inside its module (`src/webresources`, `src/plugins`, etc.).
2. Keep Dataverse HTTP and API behavior in `src/general/dataverse/` helpers.
3. Persist new workspace settings in `projectSettings` and `dataverse-powertools.json`.
4. If adding a command, update both registration code and `package.json` contributions.
5. Keep template metadata and template payload files in sync.

## Settings and secrets

- `dataverse-powertools.json` stores non-secret project settings.
- `connectionString` in settings should remain non-secret.
- Client ID/secret values are stored in VS Code secret storage.

## Webresources notes

- Webresource deployment uses direct Dataverse upsert (no SPKL deploy dependency).
- Solution association uses `webresourceSolutionName` (fallback `solutionName`).
- Migration command: `Dataverse PowerTools: Upgrade from Spkl` (shown when `spkl.json` is present).

## Validate changes

Run before opening a PR:

- `npm run lint`
- `npm run compile`

## Common pitfalls

- Storing secrets in `dataverse-powertools.json`.
- Adding Dataverse fetch logic directly in feature command files.
- Updating menu `when` conditions without updating matching runtime context keys.
- Changing templates without updating `templates/<type>/template.json` entries.
