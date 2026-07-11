# Create your first project

1. Open an **empty folder** in VS Code (`File → Open Folder`).
2. Run **Initialise Project** — from the Actions panel or the Command Palette (`Dataverse PowerTools: Initialise Project`).
3. Pick a project type:
   - **Plugins** — a .NET plugin assembly project (scaffolded via `pac plugin init`), with optional unit testing.
   - **Web Resources** — a TypeScript + webpack project with Jest tests and generated typings.
   - **Solution** — pack, unpack, export and import a Dataverse solution with `pac`.
   - **Portal** — connect to and download a Power Pages site.
4. Follow the prompts (connection details, names). The scaffold restores its own dependencies when done.

The project settings are stored in `dataverse-powertools.json` at the workspace root — secrets are **not** stored there.
