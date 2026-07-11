# Prerequisites

Dataverse PowerTools shells out to three tools, which must be installed and on your `PATH`:

| Tool | Used for | Download |
| --- | --- | --- |
| .NET SDK | Building plugin assemblies, running the typings generator | [dotnet.microsoft.com/download](https://dotnet.microsoft.com/download) |
| Node.js | Building and testing web resources | [nodejs.org/en/download](https://nodejs.org/en/download) |
| Power Platform CLI (`pac`) | Plugin scaffolding, solution pack/unpack/import/export, portals | [aka.ms/PowerPlatformCLI](https://aka.ms/PowerPlatformCLI) |

Everything else (webpack, jest, TypeScript) is installed **per project** as local dev dependencies — no global installs needed.

The **Actions panel** (Dataverse PowerTools icon in the activity bar) shows a live ✓/✗ check of all three, with download links for anything missing.
