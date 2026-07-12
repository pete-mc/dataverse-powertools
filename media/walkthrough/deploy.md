# Build and deploy

From the **Actions panel**:

- **Plugins** — *Build Package & Deploy* compiles the assembly and registers it (steps come from CodeLens decorations on your plugin classes). *Build Locally* just compiles.
- **Web Resources** — *Deploy* bundles with webpack, pushes each web resource to your solution, and **registers your decorated form events automatically** (deploying first is the only order that always works).
- **Solutions** — *Extract*, *Pack* and *Deploy* round-trip the solution between Dataverse and source control.
- **Portals** — *Select site* once, then *Download from your org* / *Upload* round-trip your Power Pages site.

Working on plugins? **View Plugin Trace Logs** (plugin card ⋯) shows the latest server-side traces — metadata, exceptions and your `ITracingService` output — right in the editor.

Watch progress in the output channel (*Show Log*) — every command logs what it runs and why it failed if something goes wrong.
