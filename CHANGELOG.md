# Change Log

All notable changes to the "dataverse-powertools" extension will be documented in this file.

## 0.14.2 (pre-release)

Completes the **Plugins — Profiling, trace & build** milestone (#135, #137, #139).

- **Profiling now finds your registered steps (#135).** *Profile a step* was reporting "No registered plugin steps to profile" for steps that were registered and firing. Root cause: the step→type query used the polymorphic `eventhandler` lookup, which doesn't resolve a plugin type for a normal step, so every step was filtered out. It now reads the step's type via the dedicated `plugintypeid` navigation (per the Dataverse docs) and excludes webhook/service-endpoint steps server-side — so your plugin steps show up.
- **Plug-in trace log status tag in the panel (#137).** A coloured pill next to the connected org shows the org-wide trace-log level — 🟢 *Trace: Off*, 🟠 *Trace: Errors*, 🔴 *Trace: All*. Click it to change the level (Off / Exception only / All) without leaving the editor; switching to *All* asks for confirmation (it has a storage/perf cost). Works under both auth types.
- **Per-step profiling toggle + Active profiles list (#139).** A **Profile: Off / On** CodeLens now sits on each `[CrmPluginRegistration(…)]` step attribute (next to *Update Filtering Attributes*) — one click enables/disables server-side profiling for *that* step, so "one class, many steps" just works. The plugin card gains an **Active profiles** block (like Form Registrations) listing every currently-profiled step with a trash-can to stop it, so it's always obvious when profiling is on. The old class-level "Profile & debug…" guide moved to the plugin card's overflow menu ("How to profile & debug…"). Enable/disable/stop use the bundled net48 tool on Windows; other platforms fall back to the guide / Web-API delete.

## 0.14.1 (pre-release)

Interactive (OAuth) auth becomes first-class for `pac` commands — fixes a whole class of "works under service principal, broken under OAuth" bugs (#128, #129, #159).

- **The extension now owns its `pac` sign-in under OAuth.** Previously, service-principal connections created a named, extension-owned `pac` profile (`dataverse-powertools`) and reused it deterministically, while interactive connections **borrowed whatever `pac` profile happened to be active** on the machine — a different tenant, user, or stale environment. That asymmetry is why early-bound generation, PCF push, portals, and solution commands could misbehave under OAuth while working under a service principal. Now an interactive connection establishes and reuses its **own** named profile too, bound to the project's environment.
- **Sign-in uses device code, falling back to a browser.** Establishing the profile runs `pac auth create … --deviceCode` and surfaces the code + sign-in link in a notification (and the output channel); if device code doesn't complete it falls back to a browser sign-in. The profile is **reused** on later commands and across environment switches (re-pointed with `pac org select`), and only re-created on a mismatch or expiry — so you sign in once, not on every command.
- **`pac` commands self-heal on an auth error.** If any `pac`-backed command (early-bound, PCF push, portals, solutions) fails with an authentication error, the extension re-establishes the profile and retries once, instead of logging a cryptic error and leaving you to work out the fix.
- **New command: *Clear pac Credentials*** — deletes the extension's saved `pac` sign-in, for a clean re-auth (e.g. to sign in as a different user).
- **Interactive sign-in respects "switch user" (#159).** Explicitly switching/reselecting an interactive connection now forces the Microsoft **account picker** (`prompt=select_account`) instead of silently reusing the previously signed-in account, and tracks the chosen account so token renewals follow the new user. Background token renewals are unchanged and never pop UI.

> Note: because `pac`'s device-code/browser sign-in needs a person the first time (there is no way to hand `pac` the extension's token), automated CI/e2e can only exercise the **reuse** path once a `dataverse-powertools` `pac` profile exists on the machine — the initial sign-in is manual by nature.

## 0.14.0 (pre-release)

New component type: **Azure Functions** (Dataverse webhook handler) — v1 core (#145).

- **Create an Azure Function component — webhook or not.** Scaffolding asks **how the function is triggered** and writes the matching handler:
  - **Dataverse webhook (HTTP)** — the headline case: a strongly-typed **`RemoteExecutionContext`** with a `ReadRemoteExecutionContextAsync()` helper, so your handler reads `ctx.InputParameters` as typed values instead of raw JSON.
  - **HTTP request** — a plain API endpoint.
  - **Timer** — a scheduled (CRON) job, e.g. a nightly Dataverse sync.

  All three get the `ServiceClient` factory for calling back into Dataverse, so a non-webhook function is a first-class citizen rather than an afterthought. The component card follows suit: a webhook leads with *Register webhook & step*, everything else leads with *Local Build* (registration stays available — you can add a webhook handler later).
- **Register the webhook + step from the editor.** *Register Webhook & Step* creates/updates the Dataverse **Service Endpoint** (webhook) and the **SDK message-processing step** pointing at your function URL — the wiring that otherwise means clicking through the Plugin Registration Tool. Works under **both auth types** (gates on the live connection, never on a tenant id). The **webhook key is stored in VS Code secret storage**, never in `dataverse-powertools.json`.
- **Local Build** (`dotnet build`) and **Generate Earlybound** (reuses the existing `pac modelbuilder` path) on the component card.

> **v1 core — please verify the live registration before relying on it.** Deferred (per #145): Azure publish (`func`/`az`) and local `func start` / send-test-context — *Deploy to Azure…* is a guide only, and no new system requirements were added. A **Service Bus trigger** is also not offered yet: `Worker.Extensions.ServiceBus` currently collides with `Microsoft.PowerPlatform.Dataverse.Client` in the Functions WorkerExtensions build (MSB3030), so it would scaffold a project that doesn't compile. The scaffolded project **is confirmed to `dotnet build` clean for all three triggers**, and the webhook/step payload shapes are unit-tested against the documented option-set values (contract=8 Webhook, messageformat=2 Json, authtype=4 WebhookKey/5 HttpHeader, `eventhandler_serviceendpoint@odata.bind`) — but the **create/update calls have not been run against a live org**. If registration is rejected, the most likely culprit is the `authvalue` encoding for the Http Header auth type.

## 0.12.0 (pre-release)

New component type: **PCF (Power Apps Component Framework) controls** — foundational slice (#141).

- **Create a PCF Control project/component.** "PCF Control" is now offered in the project-type picker and as a component you can add to a multi-component workspace. Scaffolds via `pac pcf init` and slots into the same discovery / per-component model as plugins and web resources.
- **Lifecycle commands on the PCF card:** **Push** (`pac pcf push` — the one-click dev inner loop, authenticates from the connection under both service-principal and interactive auth), **Local Build** (`npm run build`), **Refresh Types** (`npm run refreshTypes`), and **Add to Solution** (hands off to the Solution feature / `pac solution add-reference`).
- Pure, unit-tested `pac pcf` argument builders; registry ↔ package.json parity and command registration covered by the integration suite.

> **Foundational slice — please verify the live scaffold before relying on it.** Deferred to a fast-follow (per #141): live-form debug/hot-reload, the opinionated React + Fluent service-layer template with a seeded vertical slice, scaffold-time field/dataset × framework quick-pick, and Jest Test Explorer wiring. The `pac pcf init` scaffold and `pac pcf push` paths are wired but have not been run against a live environment in CI — try them and revert this pre-release if the scaffold needs additional flags (e.g. `--name`/`--namespace`).

## 0.11.0 (pre-release)

Plugins — deterministic packaging and diagnosable profiling.

- **Deterministic plugin package name + no stale deploys (#134).** *Build Package & Deploy* now clears stale `*.nupkg` from the project's `bin` before packing, so exactly one, correctly prefixed package (`<prefix>_<name>.<version>.nupkg`) is produced and deployed — fixing the intermittent `Plugin.1.0.0` vs `dvpt_Plugin.1.0.0` naming and the occasional stale-DLL deploy. The naming rules now live in one shared, unit-tested module so every path names the package identically.
- **Profiling explains an empty step list (#135).** When *Profile a step* finds no profilable steps even though steps are registered, the output now breaks down exactly why each was skipped (no resolved plugin type / system / already-profiled / other assembly), so the cause is visible instead of a bare "No registered plugin steps to profile". (The underlying case where a live step's plugin-type lookup returns empty is still under investigation — this makes it diagnosable.)

> Still open in this milestone: the trace-log status tag (#137) and the per-step profiling toggle UX (#139) are larger panel features tracked for a following release.

## 0.10.0 (pre-release)

Plugins — early-bound authoring quality-of-life.

- **New plugin classes ship ready for early-bound types (#131, #132).** A newly created plugin class now includes a `using` for the project's early-bound namespace (read from your modelbuilder settings; commented with a hint until you've run *Generate Earlybound*, so it always compiles), plus clear commented **early-bound vs late-bound** starter examples so there's a working pattern to copy.
- **Generated early-bound files compile automatically (#130).** The plugin `.csproj` now includes `..\generated\**\*.cs`, so the classes *Generate Earlybound* produces are picked up by the build without manual `<Compile>` edits (a missing folder is simply ignored).
- **Earlybound generation is now covered end-to-end.** The plugin-lifecycle e2e generates early-bound classes and builds them into the deployed package, guarding the generation → compile path against regressions.

> Note on interactive (OAuth) earlybound (#128/#129): `pac modelbuilder` authenticates through its own pac profile, which under interactive sign-in still requires a one-time `pac` browser sign-in separate from the extension's token. That limitation is documented and tracked; these two items remain open.

## 0.9.1 (pre-release)

Foundation & Quality (cont.) — test-layer depth, no user-facing change.

- **Plugin-component integration coverage (#147).** A new integration test opens a plugin-component fixture, drives *Configure Earlybound*, and asserts the **full** set of registry commands is registered — closing the gap the no-workspace test couldn't reach (the model-builder tree's `editModelBuilderSetting` registers lazily on first use). A renamed or dropped command in any of the three registration paths now fails in CI instead of only in the manual e2e.
- **Consolidated the duplicated OData string-escaper (#143).** `escapeODataString` — copy-pasted into four Dataverse Web API modules (plugin/workflow registration, assembly, package) — is now one shared, unit-tested pure module, with tests covering the `$filter` injection shape it exists to prevent. Behaviour is byte-identical.
- **e2e:** the wizard project-type quick-pick now falls back to keyboard selection when a coordinate click is intercepted by the empty-editor watermark — fixes four plugin-lifecycle e2e steps that broke after the project-type picker was reordered.

## 0.9.0 (pre-release)

Foundation & Quality — multi-component polish, safer onboarding, and a real integration test layer.

- **Panel: minimise & organise component cards (#156).** **Ungroup** a group (its members return to the list in order); **minimise/expand individual component cards**; a **multi-component workspace opens with cards minimised** by default (your manual expand/collapse persists and wins next time). A single-type project is now **capped at one component** — to hold more, convert it to a **multi-component project**, which is also renamed and **floated to the top** of the new-project picker ("Multi-component project (two or more types)").
- **Every component initialises on load (#146).** In a workspace with two components of the same type, the second one's Test Explorer tests + watchers now appear immediately instead of only after re-adding it.
- **Web Resources onboarding on Add Component (#126).** Adding a Web Resources component now generates typings and offers to create a class — the same first-create experience a standalone project gets.
- **Removed two broken Command Palette entries (#147)** — *Edit Plugin Message Filter* and *Toggle Emit Entity Type Code* were contributed but never wired up, so they failed "command not found"; both were superseded by the model-builder settings tree.
- **Under the hood:** a new CI-runnable **integration test layer** (asserts command registration and guards the multi-component Test Explorer wiring), a guard against dead command declarations, and more internal logic extracted to pure, unit-tested modules. Unit coverage 358 → 394.

## 0.8.6 (pre-release)

Test hardening + safer form-event registration.

- **Form-event registration fails fast on the schema-bug shape.** The form-XML builder now refuses to write a web-resource `<Library>` without a resolved name — the exact shape that once broke a form with `0x80048425` — turning a would-be corrupt form into a clear error. Behaviour is otherwise unchanged.
- **Under the hood (no functional change):** a new CI-runnable **integration test layer** (asserts command registration and guards the multi-component duplicate-`TestController` crash that shipped in 0.8.4), and the highest-risk internal logic extracted into pure, unit-tested modules — the form-XML builder, the model-builder (earlybound) settings helpers, and the plugin profilable-steps filter (the code path behind "No registered plugin steps to profile"). Unit coverage 358 → 386. See the testing-strategy epic (#143).

## 0.8.5 (pre-release)

Multi-component robustness — fixes for repos with two components of the same type.

- **Create Webresource Class works in a subfolder component (and honours the "create test?" answer).** In a multi-component repo, **New class** threw `ENOENT` on `library.ts` — it looked at the workspace root instead of the web-resource component, so the class file was created but the barrel export and the test were not. It now resolves against the active component, and only writes the test when you ask for one.
- **Adding a Web Resources component to a blank root substitutes the publisher prefix.** `webpack.common.js` kept the literal `SOLUTIONPREFIX` token instead of your prefix, so the built library was misnamed. The new component now carries the inherited prefix at scaffold time.
- **A second component of the same type no longer errors.** Adding a second web-resource or plugin component used to fail at the end of **Add Component** with *"duplicate controller with ID"* / *"command … already exists"* (the component was scaffolded, but the command reported an error): the Test Explorer controller collided on a hardcoded id and the plugin decoration commands re-registered. Controllers are now scoped per component, and those commands register once.
- **Component settings stay inheritance-clean.** Running a settings-writing command (e.g. **Switch Output Mode**) on a subfolder component no longer bakes the root's connection into that component's `dataverse-powertools.json` — which would have made it self-contained and stopped it tracking the root's connection changes.
- Covered by a new headless monorepo test and an extended blank-root e2e that adds **two of every component type** and verifies command targeting; the full e2e suite (43 tests, both auth types) is green.

## 0.8.4 (pre-release)

Arrange your projects (#118).

- **Drag-and-drop reordering + grouping.** In a multi-component repo, drag project cards in the Actions panel to reorder them, drop one onto a group header (or the "start a group" zone) to group related projects, and collapse groups with the caret. The arrangement (order + groups) is remembered in the connection-only root's `dataverse-powertools.json` and restored next session.
- **Add Component is gated to a components workspace.** It appears only when the root is connection-only (Empty). A single-typed-project root instead offers **Convert to a components workspace**, which moves the project into a subfolder and leaves a connection-only root — after which you can add and arrange components.

## 0.8.3 (pre-release)

Multi-component polish + build-pipeline hardening.

- **Commands target the right component automatically (#119).** In a repo with several components (multiple plugins, or a mix of plugins and web resources), running a command from the palette or command bar now infers the target from the **active editor** — the file you're looking at picks its own component — and only asks when the active file is the wrong type or nothing is open. Explicit invocations (Explorer file, panel card) still win; single-component workspaces are unchanged.
- **UI polish (#120).** The Actions panel footer gains **Docs** and **Report an issue** links, and the extension has a **new logo** — a blue→violet hexagon with a lightning bolt (Power Platform × PowerTools), redrawn as crisp SVG/PNG that reads down to activity-bar size.
- **Publish pipeline builds the capture tool from source (build only).** The Marketplace publish job now runs on a **Windows runner** and compiles the net48 plugin-profiler tool at publish time (into `tools/pluginprofiler/`) instead of shipping a committed binary. .NET Framework only builds on Windows; everything else stays cross-platform, and lint/build/test still runs on Linux.

## 0.8.2 (pre-release)

One-click plugin profiling — capture comes back into the extension (Windows).

- **Profile the next plugin run, in VS Code (#63).** The plugin card's **Debugging** section gains **Profile next run**: it installs the Plugin Profiler solution if needed, starts profiling the step you pick, waits while you trigger the plug-in, then downloads the captured run and stops profiling — no Plugin Registration Tool GUI, no separate sign-in, under both service-principal and interactive auth. This restores the capability the 0.8.1 rearchitecture had punted to PRT: a bundled net48 helper calls the profiler's own `EnablePlugin` API (what makes the profiler pipeline-executable — raw Web-API step edits don't) with the extension's own access token. **Windows-only** for capture (the profiler is .NET Framework, like replay); macOS/Linux keep the cross-platform **Download a run** / **Replay a downloaded profile** path, and the Debugging block gates the capture action accordingly.
- **Replay no longer prompts for the plugin type.** The profiler's `mbs_profile` stream is compressed, so the type is now recovered from the downloaded profile's file name — download → **Replay & debug** is prompt-free.
- Proven end to end by a new headless live lifecycle test (deploy → capture via the shipping tool → download → replay green) and the full UI suite; wiki [Debugging Plugins](https://github.com/pete-mc/dataverse-powertools/wiki/Debugging-Plugins) rewritten for the in-extension flow.

## 0.8.1 (pre-release)

Plugin-debugging rearchitecture + upgrade experience — the last pre-release before 1.0.0.

- **Plugin debugging: capture in PRT, debug in VS Code (#63/#112).** Profiling a step is done in the Plugin Registration Tool (its *Install Profiler* is the only way to make the profiler pipeline-executable — an automated capture over the Web API couldn't produce reliable profiles). Dataverse PowerTools owns the better half: **Replay a captured profile as a unit test you F5-debug in VS Code** — with the exact captured server context — instead of attaching Visual Studio to the Plugin Registration Tool. **Replay** takes a profile from *Download Captured Profiles* or any file you drop into `profiles/` (or pick via a file dialog — the same input as PRT's Replay dialog). A **Debugging** section on the plugin card and a *Profile & debug…* CodeLens on `[CrmPluginRegistration]` classes tie it together; the new [Debugging Plugins](https://github.com/pete-mc/dataverse-powertools/wiki/Debugging-Plugins) wiki page walks the flow. (The 0.8.0 in-app profiling toggle is removed — it rewired steps but never actually captured.)
- **Stale config detection + one-click refresh (#113).** Projects whose extension-owned config files (webpack/tsconfig/jest…) predate the current templates are detected on load and offered **Refresh config files**: originals are backed up to `.dvpt-upgrade-backup/<timestamp>/` first, the current templates re-render with your project's placeholders, and your code is never touched. The [Upgrading Projects](https://github.com/pete-mc/dataverse-powertools/wiki/Upgrading-Projects) wiki page (new) covers every upgrade scenario.
- **Web-resource debugging proven by tests (#114).** The comprehensive e2e sets a breakpoint in `OnLoad` through the editor, asserts it *binds*, asserts the debugger *pauses* on the hot-reloaded form, then continues.
- Wiki refreshed (pac/cross-platform rewrite + the upgrade and debugging guides).

## 0.8.0 (pre-release)

Plugin debugging via profile-and-replay (#63) and the backwards-compatibility overhaul completed (#71).

- **Debug plugins with the exact server context — no Visual Studio (#63).** Three new plugin-card actions:
  - **Profile a step…** rewires one of *your project's* registered steps through the Plugin Profiler (installed once via the Plugin Registration Tool) with hard safety rails: a full pre-change backup of the step is written to `.dvpt-profiler-backup.json` *before anything is touched*, only your own assembly's steps are offered, a step with an un-restored backup is refused, and **Stop profiling…** verifies the restored step matches the backup byte-for-byte before the backup is dropped. **Repair profiled steps** restores everything from backup at any time.
  - **Download Captured Profiles** lists the environment's captured executions (persisted Plug-in Profile rows) and saves the picked ones into `profiles/`.
  - **Replay profile as unit test** generates a `Replay_<Type>_<timestamp>.cs` in your test project that deserializes the captured context (via the pinned Plugin Registration Tool assemblies, fetched on demand into `profiler-libs/`) and invokes your plugin's `Execute` **in-process** — set breakpoints and debug it from the Test Explorer like any other test. mstest/xunit/nunit supported. Windows test host (net462), same constraint the PRT has.
- **Settings migrations completed (#71).** The central runner (settingsVersion 2) now also: imports a legacy `spkl.json` into `solutionConfig`, moves `pluginModelBuilder` out to `modelbuilder.json`, and retires the solution template's `1.1` float version (now integer 2). Migrations run identically for the root and subfolder components.
- **Legacy plugin (<v3) policy (#71):** legacy template support is now **frozen** and will be **removed in 0.9.0**. Opening a legacy project shows the migration path: *Add Component → Plugins* (it offers to move the existing project into a subfolder first), then move your classes across.
- **Fixed: Testing pane showed passing web-resource runs as failed** when Jest's output contained braces before the JSON report (e.g. the ts-jest `globals` deprecation warning). The report is now located robustly.

## 0.7.5 (pre-release)

Manual-testing feedback wave across web resources, plugins, solutions and the panel.

- **Form event registration no longer breaks forms (0x80048425) — two fixes.** The library name is now derived from settings (prefix + output mode) instead of scraped from `webpack.common.js` — the 0.7.4 per-file template broke that scrape, producing a `<Library>` with no `name` attribute that Dataverse rejected. Per-file mode (#88) now registers each handler against its source file's own `<prefix>_<name>.js`. Additionally, `RegisterEvent` decorations are validated before any form is touched (GUID form/trigger ids, `onload`/`onsave` only, non-empty function).
- **Publish-all is resilient and honest.** When Dataverse reports another publish still running (429 / 0x80071151 — e.g. right after a deploy), the publish retries with delays instead of failing; and a failed publish now reports an error instead of logging "Publish Complete".
- **Local web-resource debugging: no more hung first page.** The debug browser opens on a blank page, arms the CDP interception, then navigates — plus a stuck-page watchdog that recovers a wedged load automatically. Breakpoints now bind: the attach config maps webpack's namespaced source-map URLs (`webpack://<prefix>/…`) back to your workspace.
- **Fixed (recurring): early-bound generation under OAuth** — "No active environment set for the current auth profile". The extension now runs `pac org select --environment <org>` against the shared profile before pac commands that need an environment; a live regression test pins the behaviour.
- **Solutions: `spkl.json` retired, OAuth extract fixed.** Solution config now lives in `dataverse-powertools.json` (`solutionConfig`); an existing `spkl.json` is migrated automatically. Extract/deploy run through the shared pac auth path, so they work under OAuth too.
- **Empty (components-in-subfolders) root.** The project wizard offers a connection-only root with no parent project type — add components into subfolders from there. **Add Component in a single-project workspace now offers to switch to this nested layout**: it moves the existing project into a subfolder, leaves a connection-only root, then scaffolds the new component.
- **Web-resource output-mode selector (#88).** Switch bundled ↔ per-file from the card's ⋯ menu; switching clears `bin/` so stale artifacts of the other mode can't deploy.
- **Test Explorer web-resource runs fixed on Windows.** Jest received absolute paths whose drive-letter casing didn't match its root and reported "No tests found"; test files are now passed relative to the project. The Testing pane also discovers tests in nested components.
- **Panel: four buttons on two rows** for web resources (Local Build · Local Debug (Hot) · Generate Typings · **Run Tests** — new command running the project's local jest) and plugins (Local Build · Run Tests · Generate Earlybound · **Configure Earlybound**).
- **Component-scoped tree views.** The Earlybound Options and Form Intersects trees no longer load at activation (one view can't show several same-type projects): *Configure Earlybound* (plugin card) and *Configure form intersects* (web-resource card ⋯) open the tree on demand, scoped to the invoking component.
- **Form registrations moved into each web-resource card** — one block per component, directly under the buttons.
- **Environment card: Open Environment / Open Admin Center / Open Maker Portal.** The last two address the environment by GUID (`environmentId`, stored in `dataverse-powertools.json`; discovered automatically or asked once).
- **Switch Environment / Update Authentication now apply to every sub-component**: inherited connection fields refresh immediately and each component's solution binding is rewritten to the newly picked solution (components with their own `connectionString` are left alone).
- **Sign out everywhere:** new *Clear Stored Credentials* command (service-principal secrets, interactive token cache, pac auth profiles). The e2e suites use it between auth types so one can't mask the other's bugs (#106 hardening included: wedged-form recovery + DNS self-diagnosis).
- Azure Pipelines placeholder files removed from all templates.

## 0.7.4 (pre-release)

- **Per-file web resource output (#88).** New projects choose at creation: the classic single bundled library (default) or **one JS web resource per TypeScript file** (`webresourceOutput: "perFile"` in `dataverse-powertools.json`). Per-file mode maps 1:1 with form libraries — each `webresources_src/*.ts` builds to `bin/<prefix>_<name>.js`, exports merged onto the `<prefix>` global so forms still call `<prefix>.Class.Function`; deploy pushes every built file. Known limitation: local debug interception currently targets the bundled library.
- **Settings schema version + central migrations (#71).** `dataverse-powertools.json` now carries an explicit integer `settingsVersion`; an ordered, idempotent migration runner upgrades settings on load (root AND subfolder components identically), and files written by a newer extension are detected with a warning instead of silently mis-handled. Legacy plugin (<v3) auto-upgrade remains tracked on #71.

## 0.7.3 (pre-release)

- **Power Pages as a first-class project type (#74).** The portal flow now runs on the shared `dataverse-powertools` pac auth profile (service principal or OAuth — no more ad-hoc `pac auth` juggling), with pure unit-tested `pac pages` argument builders and structured error reporting. **Upload is new**: round-trip a site with *Download from \<org\>* / *Upload* on the portal card. *Select site* remembers your Power Pages site (`portalWebsiteId`) so download/upload target it without re-picking; the download folder is configurable via `portalDownloadPath` (default `portalpublish`).

## 0.7.2 (pre-release)

- **Reliable live web-resource debugging (#96).** Re-running **Debug Web Resources** now stops the previous session and starts fresh (no more reload-VS-Code-between-runs); stopping the debugger from VS Code's toolbar tears down the whole stack (browser, webpack watch, CDP interception); breakpoints bind reliably to your TypeScript — the debug watch build forces `inline-source-map` even for projects whose `webpack.dev.js` still says `eval-source-map` (new projects scaffold with inline maps).
- **View Plugin Trace Logs (#63, phase 1).** Pull the latest `plugintracelog` records straight into VS Code: pick from a list (✔/✖, message, entity, duration) and read the formatted trace — metadata table, exception details, and the `ITracingService` output — as a markdown document. In the plugin card's ⋯ menu and the Command Palette. Profiler capture/replay is tracked on #63 for a later wave.

## 0.7.1 (pre-release)

- **Multi-component workspaces (#47).** One repo can now hold several components in subfolders — e.g. a plugin project AND a web-resources project — each with its own `dataverse-powertools.json`. Subfolder components **inherit the root connection** (their settings file carries no credentials); the Actions panel shows **one card per component** with per-component status and actions; Explorer right-click commands target the component that owns the clicked file; ambiguous palette commands offer a quick-pick. Today's single-project workspaces are the root-component case and behave identically. Use the new **Add Component** command (panel or palette) to scaffold a component into a subfolder — a repo becomes multi-component the first time you do.
- **Fixed: early-bound generation under OAuth (#103).** When pac has no auth profiles, the extension now creates one for your org (`pac auth create --environment …`, a browser sign-in may open) instead of failing with *No profiles were found*; a failed pac run reports clearly instead of an `ENOENT scandir` exception.
- **pac runs without a shell (#104).** `pac` invocations locate the real `pac.exe` (PATH / dotnet tools) and spawn it directly; `cmd.exe /c` remains only as a fallback.
- **UI polish (#102).** Animated spinner while detecting the project; the panel updates immediately after **Switch Dataverse Environment**; the interactive auth option is now labelled **OAuth**.
- Published as a **pre-release** — switch to the pre-release channel in the Marketplace to try it.

## 0.7.0

- **New Actions panel (#100).** The activity-bar menu is now a card-based panel with live state instead of a static button list: an **environment card** (connected indicator, auth type, optional DEV/TEST/PROD badge via `environmentLabel` in `dataverse-powertools.json`, switch/auth actions), a **project card** with one primary action (e.g. *Deploy to \<org\>*), everyday buttons and a ⋯ overflow (including *Restore dependencies*), a **status line and Recent feed** showing running/succeeded/failed operations, a **Form Registrations card** (web resources) listing every `RegisterEvent` decoration in your source with click-to-open, a **live debug-session card** with a Stop button, and system requirements that collapse to a footer ✓ once green. The Local Settings and System Requirements views merged into the panel.
- **Getting Started walkthrough.** A native VS Code walkthrough (prerequisites → create a project → connect → deploy → tour) with self-completing steps; open it from `Help → Get Started` or the panel.
- **Deploy Web Resources now registers your form events automatically** and publishes once at the end (previously two full publishes). Deploy-then-register is the order that always works (#90); the standalone *Register Form Events* command remains for on-demand use.
- **Fixed: early-bound generation no longer depends on your machine's active `pac` profile.** `pac modelbuilder` now authenticates the extension's own `dataverse-powertools` profile from the project connection (like solutions do) — previously it failed when no profile was active and could silently target the wrong org with someone else's.
- **Fixed: plugin/workflow classes created from the palette or wizard landed in the workspace root**, where the nested v3 `.csproj` never compiled them. They now default into the plugin project folder.
- **New plugin projects start clean**: `pac plugin init`'s sample `Plugin1.cs` is removed and the wizard offers to create a real class; *Build Package & Deploy* now explains when the assembly has no plugin classes instead of Dataverse's cryptic `0x80040265`; a README is packed into the plugin NuGet package (silences the missing-readme warning) and `Microsoft.CrmSdk.Workflow` is marked `PrivateAssets="All"`.
- Internal: project types are now driven by a single registry (adding a type touches one descriptor + templates + package.json, enforced by parity tests) — groundwork for multi-component workspaces (#47). Coverage floor raised; new ExTester webview UI tests; UI test runs use an isolated extensions directory.

## 0.6.1

- Docs + packaging only: refreshed the contributor docs (testing/dev notes) and stopped shipping the internal `CLAUDE.md` in the published VSIX (`AGENTS.md`/`TESTING.md` were already excluded). No functional change.

## 0.6.0

- **Native Test Explorer for your project's tests (#84).** Plugin (.NET) and Web Resource (Jest) tests now appear in VS Code's Testing side bar with per-test status, run/debug from the tree or the gutter, and click-through from a failure to the assertion — instead of a wall of text in the output channel. Plugin tests run via `dotnet test` (TRX-parsed results, debuggable under the .NET debugger); web-resource tests run via the project's local Jest (`--json` with source locations, debuggable under the Node debugger). The existing **Run Tests** command still works.

## 0.5.7

- **Fixed webresource Build failing with `TS2688: Cannot find type definition file for '@types/jest'`** (#95). The production webpack build now compiles against a dedicated `tsconfig.build.json` (types dropped, tests excluded), so it no longer type-checks your Jest tests or needs `@types/jest` in the project's local `node_modules` — which it wasn't when the project lived inside another node project / a workspace / a pnpm layout. The generated XRM typings still load normally.
- **System Requirements panel no longer nags for global npm packages** (#94). webpack / webpack-cli / jest / typescript are installed per-project and run locally, so the panel stopped requiring (and offering to `npm install -g`) them. `.NET SDK`, `Node.js`, and `pac` remain the real prerequisites.
- **Register Form Events now reports failures instead of silently "succeeding"** (#90). If a form save fails (e.g. you register before the web resource is deployed, so Dataverse returns *"the dependent component WebResource … does not exist"*), the command surfaces an error and opens the log, rather than showing "All events registered". Remaining forms are still attempted, and the message says how many of how many failed.
- Internal/testing: raised the unit-coverage regression floor to match the grown suite (#80).

## 0.5.6

- **Cross-platform web-resource typings (#78, fixes #91).** Typings generation now uses a bundled **net8** build of XrmDefinitelyTyped run via `dotnet`, replacing the Windows-only `XrmDefinitelyTyped.exe`. It authenticates with the access token the extension already holds, so it works on **any OS** and under **both** service-principal and interactive (OAuth) sign-in — the latter previously failed with a "clientId cannot be null" error (#91) because the old tool was invoked with an empty client secret.
- **Faster project init.** New Web Resources projects no longer restore the redundant `Delegate.XrmDefinitelyTyped` package via paket (its only purpose was the old `.exe`); scaffolded `azure-pipelines.yml` builds against committed typings instead of regenerating them.
- **Cleaner output.** Restore and typings output channels strip npm funding/audit/deprecation noise, restore no longer raises a false error popup on non-fatal stderr, and typings/build now log a clear completion line.
- **Fixed "'webpack' is not recognized" when building/deploying web resources.** Build, Build & Deploy, and Debug Web Resources now invoke the project's local webpack via `npx` instead of a bare `webpack`, so they work without a global webpack install (the template installs it locally).
- **Fixed "Could not connect to dataverse." on Register Form Events (and silent publish) under interactive sign-in.** The form-registration and publish-customizations paths gated on a `tenantId` that interactive (OAuth) connections never set — they now gate on the live connection only (matching the deploy path), so they work under both service-principal and interactive auth.
- **Fixed a Debug Web Resources resource leak.** Stopping a debug session now terminates the whole process tree, so the `webpack --watch` child no longer keeps running (and rebuilding) after the session stops.

## 0.5.5

- Internal/testing: added end-to-end coverage for the interactive (OAuth) sign-in path — including a full wizard run that scaffolds and deploys a plugin under interactive auth — and hardened the live Edge/Chrome debug-web-resources test harness. A guarded, test-only MSAL cache seam (active only when `DVPT_TEST_MSAL_CACHE_FILE` is set) makes the interactive connect silent during automated tests; it is inert in normal use. No user-facing change.

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
