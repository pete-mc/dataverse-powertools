# Find your way around

- **Actions panel** — the Dataverse PowerTools icon in the activity bar. One card per component (a repo can hold plugins, web resources and solutions side by side — **＋ Add Component** scaffolds another into a subfolder), plus connection controls and the system-requirements check. No Command Palette needed. In a multi-component repo you can **drag project cards to reorder them** and drop one onto a group (or the "start a group" zone) to organise them — the arrangement is remembered.
- **Testing side bar** — plugin (.NET) and web-resource (Jest) tests appear in VS Code's native Test Explorer with run/debug support.
- **Explorer right-click menu** — create plugin classes, workflow classes, web-resource classes and tests next to the file you clicked.
- **CodeLens in C# files** — add or update plugin step registration decorations inline, or *Profile & debug…* to jump into the replay-debugging flow.
- **Debugging** — the plugin card's **Profile next run** captures a live plug-in execution (one click on Windows), and **Replay & debug** replays it in VS Code under the debugger so your breakpoints hit; **Debug Web Resources (local)** hot-reloads your local bundle inside the live app with breakpoints.
- **Status bar** — the `$(database)` item shows the connected environment; click it to open the panel.

The output channel (*Show Log* in the panel) is the first place to look when something misbehaves.
