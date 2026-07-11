# Build and deploy

From the **Actions panel**:

- **Plugins** — *Build Package & Deploy* compiles the assembly and registers it (steps come from CodeLens decorations on your plugin classes). *Build Locally* just compiles.
- **Web Resources** — *Deploy* bundles with webpack, pushes each web resource to your solution, and **registers your decorated form events automatically** (deploying first is the only order that always works).
- **Solutions** — *Extract*, *Pack* and *Deploy* round-trip the solution between Dataverse and source control.
- **Portals** — *Connect Portal* / *Download Portal* work against your Power Pages site.

Watch progress in the output channel (*Show Log*) — every command logs what it runs and why it failed if something goes wrong.
