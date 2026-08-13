# Change Log

All notable changes to the "dataverse-powertools" extension will be documented in this file.

Pre-release builds get a per-version entry in [CHANGELOG-prerelease.md](CHANGELOG-prerelease.md);
those entries are rolled up into one section here when a full release ships.

## 1.0.4

**Custom APIs work.** They could not before: the generated C# handler was written where the plug-in
project never compiled it.

**Generated handlers land in your plug-in project**

*Generate Custom API handlers* wrote the handler one folder above your plug-in project, and a .NET
project only compiles the C# files inside its own folder. So the handler never made it into the
assembly, the plug-in type it declares never existed, and *Deploy Custom APIs* always ended with
*"plugin type '…' not found in the environment — deploy & register the plugin first."*

Handlers now go to `<YourPluginProject>/CustomApi/<Class>.generated.cs`, and the output names the path
so you can see which project builds it. If you hit that error before, regenerate the handler, deploy the
package, then deploy the API.

The whole loop is now covered end to end against a real environment — define, generate, deploy the
package, deploy the API, then call it and check the response — so this stays fixed. Two things to know
while Custom APIs are still a preview feature: **regenerating a handler overwrites the file, including
the code you wrote in `Execute`** ([#254](https://github.com/pete-mc/dataverse-powertools/issues/254)),
and *Run Custom API…* calls Global (unbound) APIs only — use the generated TypeScript client for
table-bound ones.

## 1.0.3

**Replay & debug** now does what it says: it replays a captured plug-in run **under the debugger**, so
your breakpoints are hit. Generating the test is its own button. The legacy plugin path is gone.

**Replay & debug replays the run; Generate Replay Test writes the test**

*Replay & debug* used to only write a test file — nothing ran, nothing was debugged, and you had to go
and run it yourself. It now runs the replay with the .NET debugger attached and **stops on your
breakpoints inside your plug-in**, with the captured `Target` and everything your code derived from it
in *Locals*, and a call stack running from the test host into your own methods. It generates the test
first if there isn't one, so it works straight after a capture.

Two things had to be right for a breakpoint to be hit, and both were wrong before: the test project
targets .NET **Framework**, so the debugger has to be `clr` (not `coreclr`), and `dotnet test` runs
tests in a child **test host** — so that is the process to attach to, which needs the host to wait for
a debugger first.

**Generate Replay Test** (next to it) is the old behaviour, kept because it is a different job: write
the replay, commit it, run it in CI.

**Fixes**

- **The Profile CodeLens can stop profiling again**
  ([#251](https://github.com/pete-mc/dataverse-powertools/issues/251)). Clicking **Profile: On** to stop
  reported *"No deployed step matches …"* and left profiling on — with your step disabled. The profiled
  clone was identified by a `(Profiled)` suffix on its name, but the profiler does not name it
  consistently. It is now identified by the profiler's own assembly, the toggle checks the org before
  deciding which way to go, and it waits for the change to settle so the label tells the truth.
- **Run/Debug Test at Cursor and the gutter icons work for plug-in tests**
  ([#252](https://github.com/pete-mc/dataverse-powertools/issues/252)). Test items had no source
  location, so VS Code had nothing to anchor those actions to.
- **The activity feed no longer reports a failed operation as ✓**
  ([#229](https://github.com/pete-mc/dataverse-powertools/issues/229)). Most commands report a failure
  to the output and then return normally, and the feed called every one of those a success — including a
  deploy whose build had died. It now judges the outcome from what the command actually reported, with a
  new ⚠ state for "finished, but not everything worked" (a step that couldn't be added to the solution,
  say) so a partial result isn't flattened into either extreme.
- **First-time plug-in step registration no longer fails the whole deploy.** Creating a step returns
  `204 No Content` with the new id in a header; the code parsed a JSON body that isn't there.

**Removed**

- **The legacy (template v2) plugin path** — `src/plugins_old/`, its `spkl.exe`/`sn.exe` dependency and
  its earlybound tree ([#228](https://github.com/pete-mc/dataverse-powertools/issues/228)). Removal was
  promised for 0.9.0 and is six minor versions overdue. Opening such a project still explains how to
  migrate (*Add Component → Plugins*, which offers to move the existing project into a subfolder
  first), and every command now has one implementation.

**Added**

- **Continuous run for web-resource tests** ([#232](https://github.com/pete-mc/dataverse-powertools/issues/232)).
  The Testing view's watch toggle now works on the Jest profile: saving a file re-runs the affected
  tests — the one you are editing, or all of them if you changed a source file. It re-uses the ordinary
  run path per change rather than holding a `jest --watch` process open.

**Docs**

- The wiki's [Profiling a Plug-in Run](https://github.com/pete-mc/dataverse-powertools/wiki/Profiling-a-Plugin-Run)
  walkthrough now covers both buttons and the breakpoint flow, with screenshots taken from the
  end-to-end suite — including the debugger paused inside a plug-in mid-replay.

## 1.0.2

Profiler: a disabled step now explains itself instead of dead-ending; two end-to-end suites root-caused and green.

**"No registered plugin steps to profile" no longer dead-ends when your step is disabled
([#241](https://github.com/pete-mc/dataverse-powertools/issues/241)).**

The Plugin Profiler deactivates a step while it profiles it. If profiling is never stopped, the step
stays disabled — and a disabled step can't be profiled, so *Profile next run* correctly found nothing
and then told you to *"deploy your plugin and register a step first"*: advice you can't act on for a
step you already deployed. Worse, nothing was written to the log at all, because the diagnostic only
ran when the query returned rows and the assembly-filtered query returns none in this case.

Now both the notification and the log say what is actually wrong and how to fix it — naming the
disabled steps and pointing at *stop profiling* — on both the *Profile next run* command and the
per-step **Profile** CodeLens.

**Also**

- Two end-to-end suites that had been failing on every run are green again, and neither was the bug it
  looked like:
  - The solution **Deploy** step was waiting for four *alternative* completion phrasings from a helper
    that requires **all** of them, two of which the extension never logs. The import was succeeding
    every time; the gate was unsatisfiable, so it burned its 900-second timeout and reported the
    opposite ([#240](https://github.com/pete-mc/dataverse-powertools/issues/240)). It now gates on the
    lines that genuinely occur and confirms in about a minute.
  - The profiler suite left the step it profiled disabled, so one failed run permanently broke every
    later run. Teardown now re-enables the original step, and the suite self-heals an already-affected
    environment before asserting.
- `waitForOutput`'s all-must-match behaviour is documented, since passing a list of alternatives to it
  silently produces a permanently-red test.

## 1.0.1

FetchXML query tools (preview): find the FetchXML in your code, edit it in a generator, run it against the environment.

**FetchXML query tools ([#238](https://github.com/pete-mc/dataverse-powertools/issues/238)) —
behind the `previewFeatures` flag, sign-off in [#239](https://github.com/pete-mc/dataverse-powertools/issues/239).**

Find the FetchXML you already have in your code, edit it in a generator, and run it against the
connected environment — without leaving VS Code and without a new file type to adopt.

- **Detection in C# and TypeScript.** A CodeLens — **▶ Run · ✎ Edit in generator · ⚠ N issues** —
  appears above FetchXML in your own source. All three shapes people actually write are
  understood: a plain or verbatim string, an interpolated string / template literal, and a `+`
  concatenation chain with variables in it. Bare `<filter>` fragments (a lookup's
  `addCustomFilter`) are detected too. A query assembled with a `StringBuilder` is deliberately
  not offered rather than half-parsed.
- **Parameters, inferred.** Each interpolation becomes an `@name` parameter; its type comes from
  the column the condition compares against, so a test run prompts and validates properly. A
  GUID is checked, a date is normalised to UTC, and an `-x-days` operator is correctly treated as
  a count rather than a date. Prompted values are remembered per workspace, never written to the file.
- **Generator.** Tree of the query, per-element properties with table and column pickers from live
  metadata, grouped operator picker, an editable XML pane, and the issues list. Attributes the
  generator has no field for are preserved and shown, so an exotic query is never silently simplified.
- **Run and results.** Rows in a grid with **formatted values**, so option sets and lookups read
  as labels rather than ints and GUIDs; link-entity aliases and aggregate aliases get their own
  columns. The header states which environment and identity the query ran as — that identity is
  not who will run your plugin — and rows are capped for a test run. Copy as CSV/JSON.
- **Diagnostics worth having even if you never open the generator.** An unescaped value interpolated
  into an XML attribute (with a quick fix that wraps it in `SecurityElement.Escape` / `escapeXml`);
  a local-time date compared against a UTC column; unknown table or column names; a query too long
  for the `?fetchXml=` URL; `top` combined with paging; an aggregate attribute missing its alias;
  and an aggregate query handed to a consumer that rejects one.
- **Writing an edit back is guarded.** The edited literal is re-read with the same tokenizer that
  parsed it and the write is REFUSED unless it decodes back identically; a no-op save never touches
  the file; the change lands as a single undo step, preserving the literal's original form. **Save to
  code** also saves the file, so the query that compiles and deploys is the one you just edited.
- Snippets: `dvpt-fetch`, `dvpt-fetch-param`, `dvpt-fetch-filter`, `dvpt-escape-xml`.
- Metadata is lazy and **session-scoped** with a **Clear Dataverse Metadata Cache** command — a
  column you add in the maker portal shows up without reloading the window.

**Also**

- The unit-coverage floor is ratcheted up (statements 10 → 30, branches 11 → 34, functions
  15 → 37, lines 10 → 30): `src/query` is almost entirely pure modules, and the floor should
  follow.
- Fixed a stale assertion in the live plugin-profiler suite, which still expected the pre-0.14.44
  `ProfilerExecutionUtility.Replay(...)` generation instead of the in-process shape
  ([#210](https://github.com/pete-mc/dataverse-powertools/issues/210)); `npm run test:live` is green again.
- The FetchXML CodeLens and quick fixes also work in untitled buffers, so a query can be pasted
  into a scratch file and run.

## 1.0.0

The 1.0.0 GA — the first stable release since 0.7.0, folding in 68 pre-release builds (0.7.1 → 0.14.50).

**Highlights**

- **Multi-component workspaces (#47).** One connection-only root with each component in its own subfolder — plugins, web resources, PCF controls, Power Pages and solutions side by side, each with its own card, each command targeting its own component. Cards reorder, group and minimise (#118, #156).
- **Two new component types.** **PCF controls** — scaffold, build, push, harness with hot reload, and debug against a live form (#141). **Power Pages / Portals** — a TypeScript front-end plus a Server Logic back-end, bundled and deployed with the site (#74, #150).
- **Cross-platform.** Solutions moved off the Windows-only `spkl.exe` to `pac` (export/unpack/pack/import), and web-resource typings now run a bundled **net8** XrmDefinitelyTyped through `dotnet`, authenticated with the extension's own token (#78, #91). The everyday flows work on macOS and Linux.
- **Web resources.** Bundled or per-file output (#88), deploy that registers your form events for you in the order that actually works (#90), and live hot-reload debugging with breakpoints inside the real model-driven app (#64, #96).
- **Test Explorer.** Plugin (.NET) and web-resource (Jest) tests appear in VS Code's Testing side bar, per component (#84).
- **Copilot agent tools.** Five `#`-referenceable Language Model tools (connection, components, requirements, deploy, early-bound), read-only by default and confirmation-gated when mutating (#140).
- **Authentication.** Interactive (OAuth) connections now own their own `pac` profile with device-code sign-in and self-healing re-auth (#128, #129, #159); every Dataverse command works under both service-principal and interactive auth.
- **Panel.** Environment card with plug-in trace-log control (#137), live activity feed, form registrations, collapsing requirements footer, and a persistent, actionable sign-in card.

**Preview features**

Three features ship switched **off** while they finish manual testing — tick **Preview features** in the panel footer, or set `dataverse-powertools.previewFeatures`, to use them: **Azure Functions** (#145), **plug-in debugging** — profile a real server-side run and replay it in-process as a test you F5-debug (#63, #210) — and **Custom APIs** (#142).

Every pre-release entry is kept below.

### 0.14.50 (pre-release)

- **Preview features — untested flows now ship switched off, ready for the first full release since 0.7.0.** A new setting, `dataverse-powertools.previewFeatures` (default **off**, with a **Preview features** checkbox next to *Show Log* in the panel footer), hides features that have not completed manual testing instead of us pulling them out of the build. Gated for now, each with a manual-test sign-off checklist: **Azure Functions** (the whole component type — no card, no entry in *Add Component* / *Initialise Project*, no palette commands; [#223](https://github.com/pete-mc/dataverse-powertools/issues/223)), **plug-in debugging** (the plugin card's *Debugging* block — Profile next run, Download a run, Replay & debug — plus the per-step `Profile` CodeLens; [#224](https://github.com/pete-mc/dataverse-powertools/issues/224)) and **Custom APIs** (the five overflow actions; [#225](https://github.com/pete-mc/dataverse-powertools/issues/225)). Turning the flag on restores everything with no other change. An existing preview-type component isn't silently dropped: the panel says *"1 component hidden — Azure Functions is a preview feature"* so you know where it went. The gated list lives in one pure module (`src/general/previewFeatures.ts`) and a parity spec enforces, in both directions, that every preview command also carries `config.dataverse-powertools.previewFeatures` in its package.json `enablement` — so the panel and the palette can't disagree. The e2e/UI suites run with the flag on, so the gated flows keep their automated coverage.
- **Component cards now collapse from 3 components, not 2**, and the threshold is configurable via `dataverse-powertools.collapseCardsFrom` (default `3`; `0` always collapses). One- and two-component workspaces open expanded — the common case stopped needing a click. The count is now of the cards you actually **see**: a connection-only root used to count towards it (so an Empty root + one component collapsed that single card), and preview-hidden components don't count either. Expanding or collapsing a card by hand still wins and is still remembered per component (`layout.collapsedCards` overrides the default either way).
- **The changelog is split in two.** Pre-release notes accumulate in **[CHANGELOG-prerelease.md](CHANGELOG-prerelease.md)** (this file) so the Marketplace-facing [CHANGELOG.md](CHANGELOG.md) only grows one section per full release; the 67 pre-release sections since 0.7.0 moved here. `node scripts/rollupChangelog.mjs <version> --summary "…"` performs the roll-up at release time (folds them under one heading, demoted to `###`, then clears this file for the next cycle) and `--dry-run` previews it.

### 0.14.49 (pre-release)

- **Docs (#138) — rebuilt the plug-in debugging demo GIF now that the in-process replay actually runs (0.14.44 / [#210](https://github.com/pete-mc/dataverse-powertools/issues/210)).** The previous GIF showed a **fictional** replay API (`ProfileReader.Load` / `PluginReplay<T>` / `harness.Succeeded`) that never shipped. The new slideshow shows the **real** generated test (`ProfileReplay.LoadContext(...)` → `new AccountPostCreate(null, null).Execute(...)`), the replay **running green in the VS Code terminal** (`dotnet test` → `Passed! Failed: 0, Passed: 1`, in-process, no live org), and a rendered trace log — captured against the fabricated contoso demo connection. The screenshot fixture's replay test project is now genuinely runnable (the captured Create-of-account context, with its `Target` entity, deserialized locally and fed back through the plugin), and the generator (`src/ui-test/screenshots.ts`) gained the harness + auto-run-green capture cases (a folder-open task, so no unreliable keyboard automation). README + wiki alt text updated to match. No shipped-code change.

### 0.14.48 (pre-release)

- **Tests (#143 Move 2) — the webresource + form deploy paths now have unit coverage, completing handler coverage of the Dataverse layer.** These two flows are proven ~6× in the slow e2e tier but had **zero** unit coverage. Added `DataverseWebresource.spec.ts` (11 tests — `mapWebresourceType`, `load` (id lookup + OData escaping + throw-on-error + connection gate), the id-driven **create-vs-update** upsert, and `addToSolution` including the **"already in solution" idempotency** + the id-unresolved skip) and `DataverseForm.spec.ts` (5 tests — `getFormData`/`saveForm` round-trip through the formxml parse/build, the #90 "a failed load/save must surface, not look like success" returns, and the OAuth connection gate). Both drive the mocked `node-fetch` seam, no live org. Unit tests 805 → 821, no shipped-code change. Every HTTP-calling module in `src/general/dataverse/` now has a spec.

### 0.14.47 (pre-release)

- **Tests (#143 Move 2) — webhook + solution-component Dataverse paths now covered.** Added `serviceEndpoints.spec.ts` (9 tests — the #145 webhook `serviceendpoint` + its `sdkmessageprocessingstep`: create-vs-update upsert, and the message-not-found / filter-not-found short-circuits) and `addDataverseSolutionComponent.spec.ts` (6 tests — `AddSolutionComponent`, including the **"already in this solution" idempotency** branch where a non-OK response is still success, and the resolve-type-by-object-id composition). Both drive the mocked `node-fetch` seam, no live org. Unit tests 790 → 805, no shipped-code change.

### 0.14.46 (pre-release)

- **Tests (#143 Move 2) — the plugin-deploy Dataverse path now has unit coverage.** The `pluginpackage` and classic `pluginassembly` create/update handlers (`getDataversePluginPackage.ts`, `getDataversePluginAssembly.ts`) were untested. Added `getDataversePluginPackage.spec.ts` and `getDataversePluginAssembly.spec.ts` (16 tests) driving them against the mocked `node-fetch` seam (no live org): the **create-vs-update upsert branching**, the create-returns-204 **`OData-EntityId` header id-parse**, OData single-quote escaping, the **strong-name (`0x8004416c`) guidance** an unsigned `--skip-signing` assembly triggers, and the package→assembly materialisation poll. No shipped-code change. Unit tests 774 → 790.

### 0.14.45 (pre-release)

- **Tests (#143 Move 2) — the Plugin Profiler's whole Web API path now runs in CI against the mocked Dataverse API, with no live org.** This was the single largest untested `fetch` surface in the Dataverse layer: only the profiler's pure query builders/parsers were unit-tested, while the async calls that actually issue requests (`getPluginAssemblyProfilingInfo`, `setPluginAssemblyContent`, `getProfilableSteps`, `deleteProfilerStep`, `isProfilerInstalled`, `getPluginProfiles`, `getPluginProfileContent`) had no coverage. Extended the in-memory Web API mock (`test/dataverseFetchMock.ts`) to model `pluginassemblies` (filter-by-name + content PATCH), `sdkmessageprocessingsteps` (profilable-step list + clone DELETE), `solutions`, `mbs_pluginprofiles` (list + report-by-id) and `ImportSolution`, and added `pluginProfiles.mock.spec.ts` (11 tests) that drives the capture-prep → discover → cleanup flow end to end. It asserts the request is **shaped** correctly (the #135/#140 server-side assembly filter; keyed PATCH/DELETE; the 0.14.43 package-content prep), that behaviour is **identical under service-principal and interactive (OAuth) auth** — the recurring `tenantId`-gating bug class (#128/#129/#135) — and that an invalid connection short-circuits before any network call. No shipped-code change.

### 0.14.44 (pre-release)

- **The generated "Replay & debug" test now actually RUNS your plugin ([#210](https://github.com/pete-mc/dataverse-powertools/issues/210)).** 0.14.43 got it to *compile*; it still couldn't *run*, because the old approach called the Plugin Registration Tool's `ProfilerExecutionUtility.Replay`, which spins the plugin up in a **child AppDomain** that can't resolve assemblies inside a `dotnet test` host — so the test compiled but the replay never executed. Replay is now **in-process**: a small shared harness (`DvptProfileReplay.cs`, written once per test project) decodes the captured profile itself — base64 → raw-DEFLATE → the profiler's `<Report>` XML → its `<Context>` element, a DataContract-serialized `PluginExecutionContext` — deserializes it into an `IPluginExecutionContext`, builds the plugin's `IServiceProvider`, and the generated `Replay_*.cs` just does `new YourPlugin(null, null).Execute(sp)`. It uses **only `Microsoft.Xrm.Sdk`** (no PluginProfiler assemblies, no AppDomain), so it runs and debugs under Test Explorer / `dotnet test` with breakpoints in your plugin. A plugin that calls `IOrganizationService` gets a clear "replace the stub service with a mock" message on that call, so org-dependent branches point you at FakeXrmEasy rather than failing opaquely.
- The replay test project is wired via `Microsoft.CrmSdk.CoreAssemblies` + binding redirects (pure `ensureReplayCsproj`, unit-tested); the old profiler-assembly download (`ensureProfilerAssemblies` / `profiler-libs`) is gone — the harness is standalone.
- **Tests** — the plugin Debugging e2e's final step now runs `dotnet test` and asserts the replay passes **green** (the captured Create-of-territory context replayed back through the plugin) instead of only `dotnet build`. Verified locally end to end via a hermetic run of the exact generated harness + test against a format-faithful profile. Closes [#210](https://github.com/pete-mc/dataverse-powertools/issues/210).

### 0.14.43 (pre-release)

- **Plugin profiling now WORKS for the extension's package-deployed plugins (#208).** 0.14.42 could only *refuse* to profile them, because the Plugin Profiler reads the assembly from `pluginassembly.content`, which is null for `pac`/NuGet package assemblies. Investigation proved that `content` is **writable** and that populating it makes capture work (verified live — a real, downloadable profile, for both sync and async steps). So "Profile next run" now, for a package-deployed step, **populates `pluginassembly.content` from the local build** the extension just deployed (`findLocalPluginAssemblyDll` → `bin/**/net4x/<name>.dll`), enables + captures, and **clears the content again afterward** (it also self-heals on the next Build & deploy). The deployed package's own content isn't retrievable from Dataverse, so the local build is the source — requires a Build & deploy first. Replaces the 0.14.42 guard.
- **Fix: the generated Replay & debug test compiles.** It uses the profiler `Replay` API whose signature exposes `ITracingService`, so the test project now gets a `Microsoft.Xrm.Sdk` compile reference (the plugin project's own is `PrivateAssets` and didn't flow — `CS0012` otherwise). *Running* the replay green additionally needs the profiler replay runtime's full dependency closure in the test host — tracked in [#210](https://github.com/pete-mc/dataverse-powertools/issues/210).
- **Tests** — the plugin Debugging e2e now runs the real loop end to end: deploy → step profilable → **Profile next run prepares the package assembly + captures** → download → **Replay & debug generates** the test → **`dotnet build` compiles** it. Added `E2EClient.cleanupProfilerSteps` (org safety) + unit tests for the new pure pieces (`pluginAssemblyProfilingQuery`, `isLocalPluginDllPath`, the Xrm.Sdk csproj wiring).

### 0.14.42 (pre-release)

- **Fix: "Profile next run" now refuses package-deployed plugins with a clear message instead of a cryptic crash.** The extension deploys plugins as **packages** (`pac`/NuGet), but the Plugin Profiler can only profile **classic** plugin assemblies — it snapshots the assembly from `pluginassembly.content`, which is **null** for package assemblies. Enabling profiling anyway made the server-side profiler throw `Convert.FromBase64String(null)` → **"Unexpected Exception in the Plug-in Profiler"** on every trigger, AND left a broken profiler clone step firing on the entity (so every subsequent create/update on that table also failed). Capture now detects a package-deployed step up front (`isAssemblyPackageDeployed`) and explains — *"…the Plugin Profiler can only capture classic (non-package) plugin assemblies; debug with trace logs instead…"* — rather than starting a doomed capture. Pure `assemblyPackageQuery` + `ProfilableStep.assemblyName`, unit-tested; the deeper "make profiling work for package plugins" question is tracked in [#208](https://github.com/pete-mc/dataverse-powertools/issues/208).
- **Tests** — the plugin **Debugging** e2e (`pluginProfilerReplay.e2e.ts`) now asserts that refusal live (deploy → step is profilable → *Profile next run* refuses cleanly, no enable, no leftover profiler step), gating the click on the extension's own log **file** (`waitForLogFile`) so it doesn't need Selenium polling across the click (which lost the session on the 8GB VM). Added `E2EClient.cleanupProfilerSteps` so an interrupted capture can't leave the shared org's entity broken.

### 0.14.41 (pre-release)

- **Fix: workspace/connection commands could vanish after a re-init ("command not found").** `restoreDependencies`, `createConnectionString`, `switchEnvironment`, `refreshConnection`, `setTraceLogLevel`, `clearPacCredentials`, the `open*` portal commands, `addComponent`, `convertToComponentsWorkspace`, and `initialiseProject` were registered **inside `generalInitialise`**, which runs on every workspace (re-)load and again from **Initialise Project** (`createNewProject`). A second init in the same extension host threw `command '…' already exists`, which aborted activation and cascaded into `command 'dataverse-powertools.restoreDependencies' not found` when a panel button (e.g. the *Restore dependencies* overflow item on every component card) later fired it. These now register **once at activation** (`registerGlobalCommands`, the same register-once pattern the project-type/CodeLens/LM-tool commands already use); handlers resolve off the context singleton at invoke time, and `generalInitialise` only refreshes the connection state + the `when`-clause context keys that gate visibility. Two integration tests guard it (registered at activation without a loaded connection; register-once, so a per-load path can't re-register). No user-facing behaviour change beyond the bug going away.

### 0.14.40 (pre-release)

- **Fix: the plug-in profiler couldn't find your step in a busy org.** "Profile next run" / capture lists profilable steps via `sdkmessageprocessingsteps`, but the query fetched the first **200** active steps and filtered client-side. An org with 200+ system (`Microsoft.*`) steps filled that whole page, so a freshly-registered *user* step never appeared and capture dead-ended at "No registered plugin steps to profile." It now filters **server-side by plugin assembly** (`plugintypeid/pluginassemblyid/name eq …`) when the project's assembly is known, so your step is found regardless of how many system steps exist. Pure query generator (`buildProfilableStepsResource`) with unit tests; verified live against an org with 200+ active steps.
- **New: plug-in profiler capture → replay → execute e2e** (`src/ui-test/e2e/pluginProfilerReplay.e2e.ts`, Windows-only, live). Drives the panel's **Debugging** block end to end: scaffold a Plugins project + xUnit test project, write a plug-in registered on **Create of territory**, **Build & deploy** it, and assert the step is discoverable as **profilable** live (the fix above). The modal-driven tail (Profile next run → live Web-API trigger → **Continue** → download → **Replay & debug** → `dotnet test` the generated replay to green) is gated behind `DVPT_E2E_PROFILER_CAPTURE=1` — the reliable portion runs by default; the tail drives a VS Code modal that the shared 8GB e2e VM can't hold a Selenium session through. No change to the shipped extension beyond the profiler fix.

### 0.14.39 (pre-release)

Tests — **PCF live-form debug e2e** (`test/live/pcfLiveFormDebug.spec.ts`). A live spec that proves the "Debug on live form (hot)" interception serves the LOCAL build for a deployed control's bundle URL: it arms the extension's real CDP interception (service-worker bypass + `Fetch` + `isPcfBundleUrl`) and confirms a headless browser navigating the documented deployed-bundle URL receives our marker-stamped local bundle. Self-skips without creds/a browser. This completes the automated debug coverage alongside the existing Web-Resource hot-reload e2e (`webresourceComprehensive` step 8). No shipped-code change.

### 0.14.38 (pre-release)

- **Button-driven acceptance e2e** for the four deployable component types (Plugin, Web Resource, Solution, PCF): each drives the real main workflow — start project, write code, build, register, publish — through the **panel buttons + overflow menu** (no command palette) and verifies the outcome in Dataverse (plugin package / web resource + content / PCF control bundle / solution import). On-demand + self-skipping without creds, like the other live suites. Added a `clickOverflowItem` driver to the supervised lib. Run on the VM: **13/14 steps pass** across all four types; the one automated miss was the Solution deploy assertion's timeout being too short (the import itself logged `Solution Imported successfully` — now fixed).
- **Declare `pngjs` + `gifenc` as devDependencies** — the 0.14.35 GIF assembler (`scripts/assembleGif.mjs`) required them but they were never added to `package.json` (which also broke `npm list`). No change to the shipped extension.

### 0.14.37 (pre-release)

Security patch.

- **adm-zip 0.5.18 → 0.6.0** — fixes **CVE-2026-39244** (a crafted archive declaring a huge uncompressed size could force an unbounded `Buffer.alloc` and OOM the process). adm-zip is used to pack the plugin deploy package and read the profiler solution `.cab`. Our usage is unaffected by the release's behavior changes (we don't use `extractEntryTo`).
- **Hardened the pac client-secret path (defense-in-depth).** pac already runs via the resolved executable with no shell; the only path that could interpret a value is the rare `cmd.exe /c pac …` fallback (when `pac.exe` isn't resolvable). The client id / tenant / URL were already shape-validated — the secret now is too: it's rejected if it contains cmd.exe metacharacters (`& | < > ^ " % \`` / newlines) that could break out of that fallback command line. Real Azure client secrets never contain these, so valid credentials are never rejected.
- **Least-privilege permissions on the nightly workflow** (`contents: read`).

### 0.14.36 (pre-release)

Tests (#141) — **PCF added to the two-of-each multi-component e2e.** The blank-root suite now adds **two PCF components** (with the 0.14.29 template/framework quick-pick) alongside two of every other type, asserting each scaffolds, is type-scoped with no inherited connection, and the second doesn't collide with the first. Verified on the VM — both PCF components scaffold and discovery reports them correctly. (PCF registers no per-component TestController, so it's structurally immune to the duplicate-controller class the suite guards; this locks that in.) No change to the shipped extension.

### 0.14.35 (pre-release)

Docs (#136/#138) — **plug-in debugging demo GIF + screenshots.** A slideshow GIF (the Debugging block → the generated **Replay & debug** unit test → a rendered **trace log**) now leads the README's new "Debug plug-ins in VS Code" section and the wiki's Debugging Plugins page, with the individual function screenshots placed at their sections. Captured from the real UI against the demo (contoso) connection via the screenshots generator (new capture cases + a pure-JS GIF assembler, `scripts/assembleGif.mjs`). No change to the shipped extension code.

### 0.14.34 (pre-release)

PCF (#141) — **fix: run the build/watch at the PCF project root, not the manifest folder** (found by live verification). `pac pcf init` puts `ControlManifest.Input.xml` in a `<Constructor>/` subfolder while `package.json` / `.pcfproj` / `out/` sit at the project root, so both the new live-form debug (0.14.33) *and* the standalone harness (0.14.24) were pointing at the wrong directory — the harness's `npm start watch` would fail ("no package.json") and the live-form debug looked for `bundle.js` under the manifest dir. New `findPcfProjectRoot` helper resolves the real root; the build/watch and the local `out/controls/<Constructor>/bundle.js` now use it. **Verified end-to-end on a live org:** a deployed control's real bundle URL (`cc_<Namespace>.<Constructor>/bundle.js`) is matched and the local build is served into the browser. +3 tests (750).

### 0.14.33 (pre-release)

PCF (#141 #5) — **Debug a control on a live form (hot reload).** New **Debug on live form (hot)** command runs a locally-built PCF control *inside the real model-driven app*: it launches Edge/Chrome under the DevTools Protocol, bypasses the app's service worker (#64), and intercepts the **deployed** control's `bundle.js` request — fulfilling it from your local pcf-scripts build (`out/controls/<Constructor>/bundle.js`), which a `build --watch` rebuilds on save (the page reloads). Nothing is written to the server; it's the CDP analogue of the official Fiddler/Requestly AutoResponder debug flow. This is the live-form half of the hot-reload story (the standalone harness, 0.14.24, is the other half). The control must be deployed (`pac pcf push`) and added to a form first. The bundle-URL matcher is grounded in the documented control-bundle scheme and unit-tested; the shared CDP/browser plumbing is factored out of the web-resource debugger (`cdpProcess.ts`) and reused. +10 tests (747).

### 0.14.32 (pre-release)

Docs (#127) — **Empty/multi-component project screenshot added to the Marketplace listing.** The README now shows the *Empty* project panel (an "Or start empty — mix components in one repo" callout) alongside the three project-type images; the wiki gets the same clean cropped image and a cropped Get-Started shot. Adds a `blank` case + fixture to the screenshots generator (`src/ui-test/screenshots.ts`). No code change to the shipped extension.

### 0.14.31 (pre-release)

Testing (#143) — **extend the Dataverse Web API mock to the plugin trace-log viewer.** Building on 0.14.30, the mock now serves `plugintracelogs` and a new spec drives `getPluginTraceLogs` against it (rows, empty-org, `$orderby`/`$top`/Bearer, and identical behaviour under service-principal vs OAuth). Closes another of the epic's "specific flow gaps" with deterministic, no-live-org coverage. +5 tests (737).

### 0.14.30 (pre-release)

Testing (#143 Move 2) — **mock the Dataverse Web API.** A reusable in-memory Web API mock (`test/dataverseFetchMock.ts`) lets the extension's Dataverse clients run in CI with no live org — it models the org row (trace-level GET/PATCH) + WhoAmI over configurable state and records every request. The first spec exercises the trace-log read/write client against it and, crucially, asserts it behaves **identically under service-principal and interactive (OAuth) connections** — the recurring bug class (#128/#129/#135) was gating Dataverse calls on `tenantId`, which OAuth doesn't carry. No new dependency (a plain `fetch` shim, restored per test). +6 tests (732).

### 0.14.29 (pre-release)

PCF (#141) — **choose the control template + framework when scaffolding.** Adding a PCF component previously always ran `pac pcf init --template field --framework none`. It now asks two quick-picks up front — **template** (Field vs Dataset) and **framework** (Standard vs React) — and scaffolds accordingly. Dismissing either pick falls back to the previous field/none default, so nothing breaks. The choice values come from fixed enums (no free-text reaches the command line). Pure choice lists + argv generator unit-tested. +4 tests (726).

### 0.14.28 (pre-release)

Test harness — **pin the VS Code version for the ExTester UI / e2e / supervised runs.** ExTester defaulted to downloading the "latest" stable VS Code, and a fresh release (1.129.0) shipped an archive layout the installed `vscode-extension-tester@8.23.0` couldn't parse (`Cannot find module …/resources/app/out/cli.js`), breaking harness *setup* before any test ran. All three launchers now pin a known-good version via a single shared constant (`scripts/vscodeTestVersion.mjs`, `--code_version`), overridable per-run with `DVPT_TEST_CODE_VERSION`. No change to the shipped extension.

### 0.14.27 (pre-release)

Panel UX — **in-panel pac sign-in affordance.** When a pac command (e.g. Generate Earlybound under OAuth on a machine with no pac profile) triggers a device-code sign-in, the Dataverse PowerTools panel now shows it directly instead of relying on a toast that auto-dismisses and an output channel that isn't open by default.

- While a pac operation runs, a **busy banner** ("Signing in to Power Platform CLI…") appears at the top of the panel.
- Once pac prints the device code, that becomes a **prominent, persistent sign-in card** showing the code in large mono type plus **Copy code** and **Open sign-in page** buttons. It's the first card in the panel — impossible to miss — and clears automatically when the sign-in completes or fails.
- Security: the buttons only signal intent; the host copies the code / opens the URL from its own trusted state, never from the webview message, so the panel can't be coaxed into copying or opening arbitrary values.
- The existing toast + output-channel messages stay as a fallback. New pure state module (`pacActivityState`) + `signin` card, unit-tested (pure model) and jsdom-tested (rendered DOM + posted intents). +12 tests (722).

### 0.14.26 (pre-release)

PCF (#141) — **ControlManifest parser + de-duplicated control-dir lookup.**

- New pure `parseControlManifest(xml)` turns a `ControlManifest.Input.xml` into a typed shape — namespace, constructor, version, display-name-key, and the **inferred** pac template (`field` vs `dataset`, from `<data-set>`) and framework (`none` vs `react`, from a React `<platform-library>`). Unit-tested (the "#141 manifest parse" test item); reusable by the panel, the scaffold flow, and any "which control is this" logic.
- The `ControlManifest.Input.xml` directory walk that was copy-pasted in `addServiceLayer.ts` and `runHarness.ts` is now a single shared `findControlDir` alongside the parser. No behaviour change. +8 tests (710).

### 0.14.25 (pre-release)

Testing (#143) — **the webview panel's browser JS is now under test.** `media/menuPanel.js` (the script that turns the host-side card model into DOM and posts clicks back) previously had zero coverage anywhere — only the host-side view-model was tested. A new jsdom suite loads the *shipping script unchanged* and asserts the rendered DOM + the messages it posts: `ready` on load, one card section per model card, action-button → `execute`, the #137 trace-log pill → its execute action, requirements Download → `openExternal`, the new-group drop zone appearing at two arrangeable cards, stale-DOM clearing, and non-model messages ignored. No change to the browser code, so no regression risk to the live panel. +8 tests (702).

### 0.14.24 (pre-release)

PCF (#141) — **Run PCF test harness (hot reload)**, the standalone-harness half of the debug/hot-reload story (#5).

- **Run PCF test harness (hot reload)** (PCF card / palette) launches `npm start watch` — the pcf-scripts test-harness dev server with its **built-in hot reload** — in a terminal. Edit your control's TS and the harness rebuilds and reloads instantly. This is the easy inner loop for isolated UI work (not a live model-driven form).

> The **live-form** hot reload (redirecting a *deployed* control's bundle into a real form via CDP + the #64 service-worker bypass) is the separate, harder half — it needs a live control on a running app to verify, so it stays for a supervised session. The standalone harness (this) is the no-CDP path and works today.

### 0.14.23 (pre-release)

PCF (#141) / testing (#150 #6) — the **service-layer template now ships with a Jest test**. **Add PCF service-layer structure** additionally writes `services/<Entity>Service.spec.ts` — a Jest unit test that exercises the service with a mocked `ComponentFramework.WebApi`, demonstrating that the domain layer is testable in isolation (no PCF host, no live Dataverse). This is the "service-layer templates have Jest tests" piece of the test story; the extension's existing Jest TestController (`parseJestJson`) then surfaces it once `npx jest` is wired in the control. +1 test.

### 0.14.22 (pre-release)

PCF (#141) — the **service-layer template** (option 3, the opinionated structure), as a scaffold you can add to any control.

- **Add PCF service-layer structure** (PCF card / palette) writes the batteries-included separation into your control: a pure-TS `Service` (Dataverse/`WebApi`, unit-testable), a `use…` hook (state binding), a presentational Fluent `List`, and a `Container` that wires them — plus an **`index.ts.example`** showing exactly how to delegate `updateView` to the container (matching the documented `ComponentFramework.ReactControl` contract). Prompts for an example entity name; skips any file that already exists.
- **Additive by design:** it writes `index.ts.example` (not `index.ts`), so it never overwrites your generated entry point and can't break the build — you copy the `updateView` + imports across. This is the template counterpart to the 0.14.5 snippets. File contents are pure + unit-tested (6 tests).

> **Pre-release:** the generated files follow the documented React-control contract and the proven snippet patterns, but the control hasn't been `pac pcf init` + built end-to-end in this environment — build it once to confirm before relying.

### 0.14.21 (pre-release)

Power Pages / Portals (#150) — **typed portal Web API client** (issue #4, second half). Completes the end-to-end typing story: portal JS hitting Dataverse tables gets IntelliSense instead of untyped string-bashing.

- **New portal Web API definition** seeds a `*.portalapi.json` (entity set + typed fields). **Generate portal Web API client** emits `<entitySet>.webapi.ts` — a typed record interface plus `create`/`retrieve`/`retrieveMultiple`/`update`/`delete` helpers over the documented portal Web API (`webapi.safeAjax` — the CSRF wrapper — against `/_api/<entitySet>`, with `create` returning the new record id from the `entityid` header). Pure codegen, 6 unit tests.

> The `webapi.safeAjax` pattern + verbs/URLs are taken verbatim from the [official portal Web API docs](https://learn.microsoft.com/power-pages/configure/write-update-delete-operations) — I earlier deferred this thinking the CSRF mechanism was undocumented; it isn't. With the Server Logic client (0.14.18), **both** typed-caller halves of #150 #4 now exist. Pre-release: not yet exercised against a live site.

### 0.14.20 (pre-release)

Azure Functions (#145) — **Send test context** (issue #7), the local inner loop for webhook functions.

- **Send test RemoteExecutionContext to local function** builds a sample Dataverse webhook payload — a `RemoteExecutionContext` in the platform's **exact documented DataContractJson wire format** (typed `InputParameters["Target"]` entity with the `__type` discriminator, `/Date(ms)/` timestamps, all top-level fields) — and POSTs it to your locally-running function (`func start`), so you can exercise the typed handler without a live Dataverse trigger. Prompts for the function name, message, and primary entity. The payload generator is pure + unit-tested against the documented shape (5 tests), so `ReadRemoteExecutionContextAsync` deserializes it correctly.

> This closes the last v1-core-adjacent gap in #145 — earlier deferred because I wouldn't hand-generate the payload blind; the shape is now taken verbatim from the [official webhook docs](https://learn.microsoft.com/power-apps/developer/data-platform/use-webhooks). Requires the local host running (`Run locally (func start)`).

### 0.14.19 (pre-release)

Power Pages / Portals (#150) — **portal-wide build** (issues #1 + #2 together), on the portal card.

- **Build Power Pages portal (front-end + Server Logic)** walks the portal for TypeScript sources and builds each by convention: files under a `frontend/` folder → browser web-file bundles, files under `backend/` → Server Logic single-script bundles (+ blocked-pattern lint on each). `shared/` code is inlined into both by esbuild — never built on its own; `.d.ts`/spec/test files are skipped. One click builds the whole portal's TypeScript. The classify-and-plan logic is pure + unit-tested (5 tests).

> **Pre-release:** convention-based (`frontend/`, `backend/`, `shared/`); requires esbuild in the project; the site upload/serve round-trip isn't verified here. This composes the 0.14.16–0.14.18 building blocks into the portal-card action; the full component-model discovery + hot-reload are the remaining #150 slices (need a live pac-downloaded site to confirm structure).

### 0.14.18 (pre-release)

Power Pages / Portals (#150) — **typed Server Logic client** (issue #4), end-to-end typing for portal JS that calls Server Logic.

- **New Power Pages Server Logic definition** seeds a `*.serverlogic.json` (name, HTTP method, request/response field types). **Generate Power Pages Server Logic client** emits `<name>.client.ts` — a typed `Request`/`Response` interface plus an `async` wrapper that calls `/_api/serverlogics/<name>` via `shell.safeAjax` (CSRF handled), with the request body omitted for GET/DELETE. Portal JS hitting Server Logic gets IntelliSense and compile-time safety instead of untyped string-bashing. Pure codegen, 6 unit tests.

> Design note: v1 derives the client from a small `*.serverlogic.json` definition (my call while the maintainer is away) rather than inferring types from the backend handler TS — the definition can be shared with the handler for both-ends typing, and inferring-from-handler can layer on later. **Pre-release:** not yet exercised against a live site.

### 0.14.17 (pre-release)

Power Pages / Portals (#150) — **front-end TypeScript build** (issue #1), the browser-side counterpart to the 0.14.16 Server Logic build.

- **Build Power Pages front-end web file (bundle)** (palette, any TS/TSX editor) runs esbuild to bundle the active front-end TypeScript — npm deps + shared code inlined, tree-shaken, minified, source-mapped — into a single browser **web file** (`<name>.js`) that OOTB `pac powerpages upload` serves. The build OOTB has no story for; upload stays OOTB. Pure esbuild arg building is unit-tested.

> **Pre-release:** requires esbuild in your project; the site upload/serve round-trip isn't verified here. Together with the Server Logic build (0.14.16), the two halves of the Portals "real TypeScript build" (#150) now exist as commands; the full component model (frontend/backend/shared discovery, shared-library wiring across both, typed clients, hot-reload) is the remaining slice.

### 0.14.16 (pre-release)

Power Pages / Portals (#150) — **Server Logic build**, the enabling feature (issue #2). Server Logic has no module system at runtime, so sharing code across logics is impossible OOTB; this bundles it for you.

- **Build Power Pages Server Logic (bundle)** (palette, any TS editor) runs esbuild to bundle the active TypeScript file — **inlining its shared imports** — into one self-contained ES2023 script, strips the module syntax esbuild emits so the output is a classic script (top-level `get()`/`post()`, no `import`/`export`), lints the result against the [blocked-pattern list](https://learn.microsoft.com/power-pages/configure/author-server-logic#limitations), and writes `<name>.serverlogic.js` — ready for `pac powerpages upload`. Pairs with the 0.14.11 lint. Pure logic (esbuild args + the module-syntax stripper) is unit-tested (7 tests).

> **Pre-release:** requires esbuild in your project and hasn't been round-tripped through a live Power Pages site yet. This is the build core of the larger Portals component (#150) — front-end bundle, shared-library wiring, typed clients, and hot-reload are still to come.

### 0.14.15 (pre-release)

Testing epic (#143, Move 2) — **verify the workflow-activity registration orchestration** against a mocked Web API, matching 0.14.14 for plugin steps. `registerWorkflowActivities.spec.ts` asserts unchanged (no PATCH) / update (metadata differs) / skip (plugin type not in the assembly). +3 tests (655 total). The whole plugin Build & Deploy registration path — steps *and* workflow activities — is now covered in CI instead of only by the live e2e.

### 0.14.14 (pre-release)

Testing epic (#143, Move 2) — **verify the plugin-step registration orchestration against a mocked Web API**. Plugin *Build & Deploy* registers SDK message-processing steps over the Web API; that path was only exercised by the live e2e. New `registerPluginSteps.spec.ts` drives it through the `node-fetch` mock + `fakeDataverseContext` harness and asserts the four outcomes — **create** a new step, leave an identical step **unchanged** (no PATCH), **update** a step whose config differs, and **skip** a step whose plugin type isn't in the assembly. +4 tests (652 total). Continues moving the deploy-path coverage down from the fragile e2e into CI.

### 0.14.13 (pre-release)

Testing epic (#143, Move 2) — **verify the Custom API deploy orchestration against a mocked Dataverse Web API**, in CI, no live org.

- New `deployCustomApi.spec.ts` drives the deploy (shipped in 0.14.7) through the existing `node-fetch` mock + `fakeDataverseContext` harness and asserts it hits the right endpoints in the right order: **create** a new `CustomAPI` + its parameters when none exists, **PATCH** an existing one instead of re-creating, **reconcile** — `DELETE` a parameter that's been removed from the definition while `PATCH`-ing the ones that remain — and **fail cleanly** when the implementing plugin type isn't deployed. This converts the Custom API metadata deploy from "unit-tested payloads only" to "orchestration verified" (only a live org's acceptance of the payloads is now unconfirmed). +4 tests.

### 0.14.12 (pre-release)

Azure Functions (#145) — real **Azure publish** and **local run** (issues #6/#7), upgrading the previous guide-only deploy.

- **Publish to Azure (func)** — prompts for the Function App name and runs `func azure functionapp publish <app>` in a terminal (Azure sign-in handled interactively by `func`). The guide-only "Deploy to Azure…" stays as a fallback.
- **Run locally (func start)** — starts the Functions host in a terminal for the inner loop.

Both sit on the Azure Functions component card's overflow. Pure `func` arg building is unit-tested.

> **Pre-release:** these shell out to Azure Functions Core Tools (`func`) and, for publish, expect you to be signed in to Azure with the Function App already created — verify against your subscription. Not yet delivered for #145: a **Send Test Context** command — the `RemoteExecutionContext` webhook payload uses `DataContractJsonSerializer`'s exact wire format, which I won't hand-generate blindly; it needs a captured real payload or a live func host to validate against.

### 0.14.11 (pre-release)

Power Pages / Portals (#150) — **Server Logic restricted-pattern lint**, the first slice of the Portals TypeScript story.

- **Lint Power Pages Server Logic** (palette, any JS/TS editor) checks your script against the platform's [blocked-pattern list](https://learn.microsoft.com/power-pages/configure/author-server-logic#limitations) — `import`/`require`, `eval`/`Function`, `setTimeout`/`setInterval`/`setImmediate`, `process`/`child_process`, `fs`, prototype manipulation (`__proto__`, `Object.setPrototypeOf`, `constructor.constructor`), `Proxy`/`Reflect`, `with`/`delete`, `debugger`, and more — plus unavailable browser APIs (`fetch`, `XMLHttpRequest`). Findings show as inline diagnostics (errors for blocked, warnings for unsupported) so you catch them **before** `pac powerpages upload` rejects the script with a cryptic message. Comments and string literals are ignored to avoid false positives. Pure lint engine, 27 unit tests.

> This is one slice of the larger Portals component (#150). The TypeScript build pipeline (front-end bundle, Server-Logic-to-single-script bundling with inlined shared code, hot-reload, typed clients) is still to come and needs live-site verification.

### 0.14.10 (pre-release)

Custom API (#142) — **Run Custom API from the editor** (issue #4). Completes the Custom API feature set: define → generate handler → deploy → **invoke**, plus the typed caller.

- **Run Custom API…** (plugin card / palette) picks a `*.customapi.json`, prompts for each request parameter (validating JSON for complex types), calls the API with the extension's token, and prints the response to the output channel — the Postman round-trip replaced by an inner loop that's correct-by-construction (the request comes from the same definition that was deployed). Handles Actions (POST body) and Functions (parameter-aliased GET URL); values are coerced to the right JSON types. Works under both auth types. Request shaping is pure + unit-tested (11 tests).

> v1 supports **Global (unbound)** Custom APIs; bound APIs point you to the generated TS client. **Pre-release:** the HTTP invoke, like the metadata deploy, hasn't been exercised against a live org yet — verify before relying.

With this, **#142 (Custom API) is feature-complete** across definition-as-code (#1), typed handler (#2), deploy + reconcile (#3), invoke (#4), typed caller (#5), and validation (#6).

### 0.14.9 (pre-release)

Custom API (#142) — **typed TypeScript caller** (issue #5). The same definition that generates the C# handler and deploys the metadata now also generates a **typed client for web-resource / PCF callers**, so a form script calling your API gets IntelliSense and compile-time safety instead of hand-rolling the `Xrm.WebApi` request shape.

- **Generate Custom API TS clients** (plugin card / palette) emits, for each `*.customapi.json`, a `clients/<Class>.client.ts` with a typed `Request`/`Response` interface and an `async` wrapper that builds the correct `Xrm.WebApi.online.execute` `getMetadata()` shape (parameter Edm types, `structuralProperty`, `operationType` 0/1 for action/function). Copy it into your web-resource or PCF project and call the API with full types. End-to-end typing now spans handler ⇄ metadata ⇄ caller. 15 unit tests cover the type maps and generated shape.

### 0.14.8 (pre-release)

New: **Language Model Tools** — drive the extension from Copilot agent mode (#140). In-editor only; no MCP server, no port, no token, no files written.

- **Five `#`-referenceable tools** appear in Copilot's tool picker the moment the extension activates:
  - **Read (always on):** `dvpt_connectionStatus` (org + auth type + connected — never secrets), `dvpt_listComponents` (discovered plugins / web resources / PCF / functions), `dvpt_systemRequirements` (dotnet / node / pac).
  - **Mutating (gated + confirmed):** `dvpt_deploy` (build & deploy) and `dvpt_generateEarlybound`. These are **off by default** — set `dataverse-powertools.copilot.accessMode` to `readwrite` to enable them — and each shows a native "run against `<org>`?" confirmation before it executes.
- Tools are thin wrappers over the same command paths the UI uses (so a future MCP surface can reuse the handler logic), registered once globally (never per-component), and every mutating tool gates on the live connection under both auth types.

> **Requires VS Code 1.95+** (the Language Model Tools API) — the extension's minimum engine moves from 1.93 to 1.95. Pure logic (tool list, access-mode gate, secret-free formatters) is unit-tested; registration is covered by an integration test.

### 0.14.7 (pre-release)

Custom API (#142) — **metadata deploy** (issue #3), the second half of the v1 core. A definition now round-trips: edit → generate handler → **deploy the message to Dataverse**.

- **Deploy Custom APIs** (plugin card / palette) pushes every `*.customapi.json` in the plugin to the environment: creates or updates the `CustomAPI` record, then **reconciles** its request parameters and response properties — creating new ones, updating changed labels, and **deleting any removed from the file** (the definition is the source of truth). Resolves the implementing plugin type first (and tells you to deploy the plugin if it's missing), then adds the Custom API to the project's solution.
- **Correct by construction.** Option-set values (binding 0–2, processing-step 0–2, `customapifieldtype` 0–12) and the **immutable-after-save** column rules (updates omit `bindingtype` / `isfunction` / `uniquename` / `type` so the platform doesn't reject them) are taken straight from the Microsoft docs and unit-tested (12 tests). Works under **both auth types** (gates on the live connection, not the tenant).

> **Pre-release — verify against an org before relying.** The payload shapes, option-set values and reconcile logic are docs-verified and unit-tested, but the create/update/**delete** calls have not yet been exercised against a live environment (there's no headless Web API test harness). Treat the first real deploy as a supervised check — especially the delete-reconcile of parameters. Remaining #142 fast-follows: invoke-from-editor (#4) and reverse-engineer + typed caller (#5).

### 0.14.6 (pre-release)

New: **Custom API / Custom Actions — definition-as-code** (#142), the core enabler + typed handler generation. Revives the parked Custom API milestone.

- **One definition file is the source of truth.** A `*.customapi.json` describes the API — unique name, binding (Global / Entity / EntityCollection), function-vs-action, request parameters + response properties (typed), the implementing plugin type — with field names that mirror the Dataverse `CustomAPI` tables so a future metadata deploy maps 1:1. **New Custom API definition** (plugin card / palette) seeds a valid sample.
- **Typed C# handler generation — the differentiator (#142 issue #2).** **Generate Custom API handlers** reads every definition in the plugin, validates it, and emits a strongly-typed handler: a request wrapper that reads `InputParameters` as typed values (`request.AccountId` is an `EntityReference`, not a magic-string cast), a response wrapper that writes `OutputParameters`, and the `IPlugin` class stub. Change the definition, regenerate, and the **compiler points at the drift**.
- **Local validation before deploy (#142 issues #1/#6).** Catches the errors the platform would otherwise reject — missing required fields, invalid unique names, binding-requires-bound-entity (and Global-forbids-it), duplicate parameter names, invalid types — with readable messages.

> **Architecture decision (v1):** a Custom API is a **plugin-scoped** definition file (it lives in a plugin component and is implemented by that plugin), not a separate component type — matching "almost always implemented by a plugin" and avoiding a duplicate component surface. The pure core (definition / validate / codegen) is unit-tested (27 tests). **Metadata deploy (#3, create/update/reconcile `CustomAPI` + params via the Web API) and the invoke-from-editor / typed-caller fast-follows (#4–#5) are not in this slice** — the generated handler and definition are ready; wiring them into the deploy is next.

### 0.14.5 (pre-release)

PCF (#141) — ship the service-layer pattern as **VS Code snippets** (the 80/20 alternative to code-generator commands).

- **Three snippets, discoverable in IntelliSense**, that seed the extension's opinionated service/hook/component separation without adding commands or context keys:
  - `dvpt-service` — a pure-TS service (Dataverse `WebApi` + domain logic, no React/PCF types → unit-testable).
  - `dvpt-hook` — a thin `useXyz()` binding that wires a service to React state (loading/error handled).
  - `dvpt-component` — a presentational Fluent UI component driven entirely by props.

  Type the prefix in any `.ts`/`.tsx` file. They compose with the existing `pac pcf init` field/dataset × framework scaffold, so you can grow a plain React control into the layered structure incrementally. Guarded by a unit test (valid JSON, expected prefixes, still registered in `package.json`).

### 0.14.4 (pre-release)

Testing epic (#143), Move 3 — extract trapped pure logic into `vscode`-free modules and unit-test it, so the network/registration payload shapes and the panel/test-scaffold logic are guarded in CI instead of only by the manual e2e. No behaviour change; 62 new unit tests (478 → 540).

- **Plugin-step & workflow-activity registration payloads** — extracted into `src/general/dataverse/stepPayloads.ts`: the `@odata.bind` step body (`buildStepPayload`), the "does the live step differ" diff (`stepNeedsUpdate` / `normalizeFilteringAttributes`), and the sparse workflow-activity PATCH generator (`getWorkflowPatchPayload`). These build the exact bodies Dataverse receives during Deploy — now covered by 22 tests.
- **Panel project-card view-model** — `src/panel/panelCards.ts`: the settings→card field mapping (name fallback chain, `.csproj` detail, trigger passthrough) and the time formatter, split from the fs/vscode reads in `panelState.ts`.
- **Plugin unit-test scaffolding logic** — `src/plugins/unitTestingLogic.ts`: target-framework compatibility resolution (`net462`→`net472`, netstandard→`net8.0`), C# language-version parsing, class-name sanitising, and the per-framework boilerplate.

### 0.14.3 (pre-release)

Completes the OAuth `pac` fix from 0.14.1 (#128, #129) — the reason it "worked but did nothing".

- **`pac` failures are now detected from output, not the exit code.** `pac` (2.8.1) returns **exit code 0 even when a command fails** — no auth profile, a bad profile name, an expired token. The extension trusted that exit code, so under OAuth it would log *"Reusing the pac profile"* for a profile that didn't exist and then *"Plugin early bound generation complete"* having generated **zero files** — a silent false success. Early-bound generation, and any other `pac`-backed command, now inspect `pac`'s actual output (`pac auth list` for profile existence, plus an `Error:` banner check) and only report success when work was really done; on a genuine failure they surface the error and open the output channel instead of pretending it worked.
- **Found by a new supervised UI test.** A human-assisted, on-demand suite (`npm run test:supervised`, *not* in CI) drives the real panel buttons through the OAuth `pac` path end-to-end — blank multi-component project → OAuth sign-in → add Plugins → Generate Early-bound — and is what surfaced the false-success above. It captures the sign-in once and reuses it for unattended fix iterations. This is the first slice; build → deploy → profile → debug → trace follow.

### 0.14.2 (pre-release)

Completes the **Plugins — Profiling, trace & build** milestone (#135, #137, #139).

- **Profiling now finds your registered steps (#135).** *Profile a step* was reporting "No registered plugin steps to profile" for steps that were registered and firing. Root cause: the step→type query used the polymorphic `eventhandler` lookup, which doesn't resolve a plugin type for a normal step, so every step was filtered out. It now reads the step's type via the dedicated `plugintypeid` navigation (per the Dataverse docs) and excludes webhook/service-endpoint steps server-side — so your plugin steps show up.
- **Plug-in trace log status tag in the panel (#137).** A coloured pill next to the connected org shows the org-wide trace-log level — 🟢 *Trace: Off*, 🟠 *Trace: Errors*, 🔴 *Trace: All*. Click it to change the level (Off / Exception only / All) without leaving the editor; switching to *All* asks for confirmation (it has a storage/perf cost). Works under both auth types.
- **Per-step profiling toggle + Active profiles list (#139).** A **Profile: Off / On** CodeLens now sits on each `[CrmPluginRegistration(…)]` step attribute (next to *Update Filtering Attributes*) — one click enables/disables server-side profiling for *that* step, so "one class, many steps" just works. The plugin card gains an **Active profiles** block (like Form Registrations) listing every currently-profiled step with a trash-can to stop it, so it's always obvious when profiling is on. The old class-level "Profile & debug…" guide moved to the plugin card's overflow menu ("How to profile & debug…"). Enable/disable/stop use the bundled net48 tool on Windows; other platforms fall back to the guide / Web-API delete.

### 0.14.1 (pre-release)

Interactive (OAuth) auth becomes first-class for `pac` commands — fixes a whole class of "works under service principal, broken under OAuth" bugs (#128, #129, #159).

- **The extension now owns its `pac` sign-in under OAuth.** Previously, service-principal connections created a named, extension-owned `pac` profile (`dataverse-powertools`) and reused it deterministically, while interactive connections **borrowed whatever `pac` profile happened to be active** on the machine — a different tenant, user, or stale environment. That asymmetry is why early-bound generation, PCF push, portals, and solution commands could misbehave under OAuth while working under a service principal. Now an interactive connection establishes and reuses its **own** named profile too, bound to the project's environment.
- **Sign-in uses device code, falling back to a browser.** Establishing the profile runs `pac auth create … --deviceCode` and surfaces the code + sign-in link in a notification (and the output channel); if device code doesn't complete it falls back to a browser sign-in. The profile is **reused** on later commands and across environment switches (re-pointed with `pac org select`), and only re-created on a mismatch or expiry — so you sign in once, not on every command.
- **`pac` commands self-heal on an auth error.** If any `pac`-backed command (early-bound, PCF push, portals, solutions) fails with an authentication error, the extension re-establishes the profile and retries once, instead of logging a cryptic error and leaving you to work out the fix.
- **New command: *Clear pac Credentials*** — deletes the extension's saved `pac` sign-in, for a clean re-auth (e.g. to sign in as a different user).
- **Interactive sign-in respects "switch user" (#159).** Explicitly switching/reselecting an interactive connection now forces the Microsoft **account picker** (`prompt=select_account`) instead of silently reusing the previously signed-in account, and tracks the chosen account so token renewals follow the new user. Background token renewals are unchanged and never pop UI.

> Note: because `pac`'s device-code/browser sign-in needs a person the first time (there is no way to hand `pac` the extension's token), automated CI/e2e can only exercise the **reuse** path once a `dataverse-powertools` `pac` profile exists on the machine — the initial sign-in is manual by nature.

### 0.14.0 (pre-release)

New component type: **Azure Functions** (Dataverse webhook handler) — v1 core (#145).

- **Create an Azure Function component — webhook or not.** Scaffolding asks **how the function is triggered** and writes the matching handler:
  - **Dataverse webhook (HTTP)** — the headline case: a strongly-typed **`RemoteExecutionContext`** with a `ReadRemoteExecutionContextAsync()` helper, so your handler reads `ctx.InputParameters` as typed values instead of raw JSON.
  - **HTTP request** — a plain API endpoint.
  - **Timer** — a scheduled (CRON) job, e.g. a nightly Dataverse sync.

  All three get the `ServiceClient` factory for calling back into Dataverse, so a non-webhook function is a first-class citizen rather than an afterthought. The component card follows suit: a webhook leads with *Register webhook & step*, everything else leads with *Local Build* (registration stays available — you can add a webhook handler later).
- **Register the webhook + step from the editor.** *Register Webhook & Step* creates/updates the Dataverse **Service Endpoint** (webhook) and the **SDK message-processing step** pointing at your function URL — the wiring that otherwise means clicking through the Plugin Registration Tool. Works under **both auth types** (gates on the live connection, never on a tenant id). The **webhook key is stored in VS Code secret storage**, never in `dataverse-powertools.json`.
- **Local Build** (`dotnet build`) and **Generate Earlybound** (reuses the existing `pac modelbuilder` path) on the component card.

> **v1 core — please verify the live registration before relying on it.** Deferred (per #145): Azure publish (`func`/`az`) and local `func start` / send-test-context — *Deploy to Azure…* is a guide only, and no new system requirements were added. A **Service Bus trigger** is also not offered yet: `Worker.Extensions.ServiceBus` currently collides with `Microsoft.PowerPlatform.Dataverse.Client` in the Functions WorkerExtensions build (MSB3030), so it would scaffold a project that doesn't compile. The scaffolded project **is confirmed to `dotnet build` clean for all three triggers**, and the webhook/step payload shapes are unit-tested against the documented option-set values (contract=8 Webhook, messageformat=2 Json, authtype=4 WebhookKey/5 HttpHeader, `eventhandler_serviceendpoint@odata.bind`) — but the **create/update calls have not been run against a live org**. If registration is rejected, the most likely culprit is the `authvalue` encoding for the Http Header auth type.

### 0.12.0 (pre-release)

New component type: **PCF (Power Apps Component Framework) controls** — foundational slice (#141).

- **Create a PCF Control project/component.** "PCF Control" is now offered in the project-type picker and as a component you can add to a multi-component workspace. Scaffolds via `pac pcf init` and slots into the same discovery / per-component model as plugins and web resources.
- **Lifecycle commands on the PCF card:** **Push** (`pac pcf push` — the one-click dev inner loop, authenticates from the connection under both service-principal and interactive auth), **Local Build** (`npm run build`), **Refresh Types** (`npm run refreshTypes`), and **Add to Solution** (hands off to the Solution feature / `pac solution add-reference`).
- Pure, unit-tested `pac pcf` argument builders; registry ↔ package.json parity and command registration covered by the integration suite.

> **Foundational slice — please verify the live scaffold before relying on it.** Deferred to a fast-follow (per #141): live-form debug/hot-reload, the opinionated React + Fluent service-layer template with a seeded vertical slice, scaffold-time field/dataset × framework quick-pick, and Jest Test Explorer wiring. The `pac pcf init` scaffold and `pac pcf push` paths are wired but have not been run against a live environment in CI — try them and revert this pre-release if the scaffold needs additional flags (e.g. `--name`/`--namespace`).

### 0.11.0 (pre-release)

Plugins — deterministic packaging and diagnosable profiling.

- **Deterministic plugin package name + no stale deploys (#134).** *Build Package & Deploy* now clears stale `*.nupkg` from the project's `bin` before packing, so exactly one, correctly prefixed package (`<prefix>_<name>.<version>.nupkg`) is produced and deployed — fixing the intermittent `Plugin.1.0.0` vs `dvpt_Plugin.1.0.0` naming and the occasional stale-DLL deploy. The naming rules now live in one shared, unit-tested module so every path names the package identically.
- **Profiling explains an empty step list (#135).** When *Profile a step* finds no profilable steps even though steps are registered, the output now breaks down exactly why each was skipped (no resolved plugin type / system / already-profiled / other assembly), so the cause is visible instead of a bare "No registered plugin steps to profile". (The underlying case where a live step's plugin-type lookup returns empty is still under investigation — this makes it diagnosable.)

> Still open in this milestone: the trace-log status tag (#137) and the per-step profiling toggle UX (#139) are larger panel features tracked for a following release.

### 0.10.0 (pre-release)

Plugins — early-bound authoring quality-of-life.

- **New plugin classes ship ready for early-bound types (#131, #132).** A newly created plugin class now includes a `using` for the project's early-bound namespace (read from your modelbuilder settings; commented with a hint until you've run *Generate Earlybound*, so it always compiles), plus clear commented **early-bound vs late-bound** starter examples so there's a working pattern to copy.
- **Generated early-bound files compile automatically (#130).** The plugin `.csproj` now includes `..\generated\**\*.cs`, so the classes *Generate Earlybound* produces are picked up by the build without manual `<Compile>` edits (a missing folder is simply ignored).
- **Earlybound generation is now covered end-to-end.** The plugin-lifecycle e2e generates early-bound classes and builds them into the deployed package, guarding the generation → compile path against regressions.

> Note on interactive (OAuth) earlybound (#128/#129): `pac modelbuilder` authenticates through its own pac profile, which under interactive sign-in still requires a one-time `pac` browser sign-in separate from the extension's token. That limitation is documented and tracked; these two items remain open.

### 0.9.1 (pre-release)

Foundation & Quality (cont.) — test-layer depth, no user-facing change.

- **Plugin-component integration coverage (#147).** A new integration test opens a plugin-component fixture, drives *Configure Earlybound*, and asserts the **full** set of registry commands is registered — closing the gap the no-workspace test couldn't reach (the model-generator tree's `editModelBuilderSetting` registers lazily on first use). A renamed or dropped command in any of the three registration paths now fails in CI instead of only in the manual e2e.
- **Consolidated the duplicated OData string-escaper (#143).** `escapeODataString` — copy-pasted into four Dataverse Web API modules (plugin/workflow registration, assembly, package) — is now one shared, unit-tested pure module, with tests covering the `$filter` injection shape it exists to prevent. Behaviour is byte-identical.
- **e2e:** the wizard project-type quick-pick now falls back to keyboard selection when a coordinate click is intercepted by the empty-editor watermark — fixes four plugin-lifecycle e2e steps that broke after the project-type picker was reordered.

### 0.9.0 (pre-release)

Foundation & Quality — multi-component polish, safer onboarding, and a real integration test layer.

- **Panel: minimise & organise component cards (#156).** **Ungroup** a group (its members return to the list in order); **minimise/expand individual component cards**; a **multi-component workspace opens with cards minimised** by default (your manual expand/collapse persists and wins next time). A single-type project is now **capped at one component** — to hold more, convert it to a **multi-component project**, which is also renamed and **floated to the top** of the new-project picker ("Multi-component project (two or more types)").
- **Every component initialises on load (#146).** In a workspace with two components of the same type, the second one's Test Explorer tests + watchers now appear immediately instead of only after re-adding it.
- **Web Resources onboarding on Add Component (#126).** Adding a Web Resources component now generates typings and offers to create a class — the same first-create experience a standalone project gets.
- **Removed two broken Command Palette entries (#147)** — *Edit Plugin Message Filter* and *Toggle Emit Entity Type Code* were contributed but never wired up, so they failed "command not found"; both were superseded by the model-generator settings tree.
- **Under the hood:** a new CI-runnable **integration test layer** (asserts command registration and guards the multi-component Test Explorer wiring), a guard against dead command declarations, and more internal logic extracted to pure, unit-tested modules. Unit coverage 358 → 394.

### 0.8.6 (pre-release)

Test hardening + safer form-event registration.

- **Form-event registration fails fast on the schema-bug shape.** The form-XML generator now refuses to write a web-resource `<Library>` without a resolved name — the exact shape that once broke a form with `0x80048425` — turning a would-be corrupt form into a clear error. Behaviour is otherwise unchanged.
- **Under the hood (no functional change):** a new CI-runnable **integration test layer** (asserts command registration and guards the multi-component duplicate-`TestController` crash that shipped in 0.8.4), and the highest-risk internal logic extracted into pure, unit-tested modules — the form-XML generator, the model-generator (earlybound) settings helpers, and the plugin profilable-steps filter (the code path behind "No registered plugin steps to profile"). Unit coverage 358 → 386. See the testing-strategy epic (#143).

### 0.8.5 (pre-release)

Multi-component robustness — fixes for repos with two components of the same type.

- **Create Webresource Class works in a subfolder component (and honours the "create test?" answer).** In a multi-component repo, **New class** threw `ENOENT` on `library.ts` — it looked at the workspace root instead of the web-resource component, so the class file was created but the barrel export and the test were not. It now resolves against the active component, and only writes the test when you ask for one.
- **Adding a Web Resources component to a blank root substitutes the publisher prefix.** `webpack.common.js` kept the literal `SOLUTIONPREFIX` token instead of your prefix, so the built library was misnamed. The new component now carries the inherited prefix at scaffold time.
- **A second component of the same type no longer errors.** Adding a second web-resource or plugin component used to fail at the end of **Add Component** with *"duplicate controller with ID"* / *"command … already exists"* (the component was scaffolded, but the command reported an error): the Test Explorer controller collided on a hardcoded id and the plugin decoration commands re-registered. Controllers are now scoped per component, and those commands register once.
- **Component settings stay inheritance-clean.** Running a settings-writing command (e.g. **Switch Output Mode**) on a subfolder component no longer bakes the root's connection into that component's `dataverse-powertools.json` — which would have made it self-contained and stopped it tracking the root's connection changes.
- Covered by a new headless monorepo test and an extended blank-root e2e that adds **two of every component type** and verifies command targeting; the full e2e suite (43 tests, both auth types) is green.

### 0.8.4 (pre-release)

Arrange your projects (#118).

- **Drag-and-drop reordering + grouping.** In a multi-component repo, drag project cards in the Actions panel to reorder them, drop one onto a group header (or the "start a group" zone) to group related projects, and collapse groups with the caret. The arrangement (order + groups) is remembered in the connection-only root's `dataverse-powertools.json` and restored next session.
- **Add Component is gated to a components workspace.** It appears only when the root is connection-only (Empty). A single-typed-project root instead offers **Convert to a components workspace**, which moves the project into a subfolder and leaves a connection-only root — after which you can add and arrange components.

### 0.8.3 (pre-release)

Multi-component polish + build-pipeline hardening.

- **Commands target the right component automatically (#119).** In a repo with several components (multiple plugins, or a mix of plugins and web resources), running a command from the palette or command bar now infers the target from the **active editor** — the file you're looking at picks its own component — and only asks when the active file is the wrong type or nothing is open. Explicit invocations (Explorer file, panel card) still win; single-component workspaces are unchanged.
- **UI polish (#120).** The Actions panel footer gains **Docs** and **Report an issue** links, and the extension has a **new logo** — a blue→violet hexagon with a lightning bolt (Power Platform × PowerTools), redrawn as crisp SVG/PNG that reads down to activity-bar size.
- **Publish pipeline builds the capture tool from source (build only).** The Marketplace publish job now runs on a **Windows runner** and compiles the net48 plugin-profiler tool at publish time (into `tools/pluginprofiler/`) instead of shipping a committed binary. .NET Framework only builds on Windows; everything else stays cross-platform, and lint/build/test still runs on Linux.

### 0.8.2 (pre-release)

One-click plugin profiling — capture comes back into the extension (Windows).

- **Profile the next plugin run, in VS Code (#63).** The plugin card's **Debugging** section gains **Profile next run**: it installs the Plugin Profiler solution if needed, starts profiling the step you pick, waits while you trigger the plug-in, then downloads the captured run and stops profiling — no Plugin Registration Tool GUI, no separate sign-in, under both service-principal and interactive auth. This restores the capability the 0.8.1 rearchitecture had punted to PRT: a bundled net48 helper calls the profiler's own `EnablePlugin` API (what makes the profiler pipeline-executable — raw Web-API step edits don't) with the extension's own access token. **Windows-only** for capture (the profiler is .NET Framework, like replay); macOS/Linux keep the cross-platform **Download a run** / **Replay a downloaded profile** path, and the Debugging block gates the capture action accordingly.
- **Replay no longer prompts for the plugin type.** The profiler's `mbs_profile` stream is compressed, so the type is now recovered from the downloaded profile's file name — download → **Replay & debug** is prompt-free.
- Proven end to end by a new headless live lifecycle test (deploy → capture via the shipping tool → download → replay green) and the full UI suite; wiki [Debugging Plugins](https://github.com/pete-mc/dataverse-powertools/wiki/Debugging-Plugins) rewritten for the in-extension flow.

### 0.8.1 (pre-release)

Plugin-debugging rearchitecture + upgrade experience — the last pre-release before 1.0.0.

- **Plugin debugging: capture in PRT, debug in VS Code (#63/#112).** Profiling a step is done in the Plugin Registration Tool (its *Install Profiler* is the only way to make the profiler pipeline-executable — an automated capture over the Web API couldn't produce reliable profiles). Dataverse PowerTools owns the better half: **Replay a captured profile as a unit test you F5-debug in VS Code** — with the exact captured server context — instead of attaching Visual Studio to the Plugin Registration Tool. **Replay** takes a profile from *Download Captured Profiles* or any file you drop into `profiles/` (or pick via a file dialog — the same input as PRT's Replay dialog). A **Debugging** section on the plugin card and a *Profile & debug…* CodeLens on `[CrmPluginRegistration]` classes tie it together; the new [Debugging Plugins](https://github.com/pete-mc/dataverse-powertools/wiki/Debugging-Plugins) wiki page walks the flow. (The 0.8.0 in-app profiling toggle is removed — it rewired steps but never actually captured.)
- **Stale config detection + one-click refresh (#113).** Projects whose extension-owned config files (webpack/tsconfig/jest…) predate the current templates are detected on load and offered **Refresh config files**: originals are backed up to `.dvpt-upgrade-backup/<timestamp>/` first, the current templates re-render with your project's placeholders, and your code is never touched. The [Upgrading Projects](https://github.com/pete-mc/dataverse-powertools/wiki/Upgrading-Projects) wiki page (new) covers every upgrade scenario.
- **Web-resource debugging proven by tests (#114).** The comprehensive e2e sets a breakpoint in `OnLoad` through the editor, asserts it *binds*, asserts the debugger *pauses* on the hot-reloaded form, then continues.
- Wiki refreshed (pac/cross-platform rewrite + the upgrade and debugging guides).

### 0.8.0 (pre-release)

Plugin debugging via profile-and-replay (#63) and the backwards-compatibility overhaul completed (#71).

- **Debug plugins with the exact server context — no Visual Studio (#63).** Three new plugin-card actions:
  - **Profile a step…** rewires one of *your project's* registered steps through the Plugin Profiler (installed once via the Plugin Registration Tool) with hard safety rails: a full pre-change backup of the step is written to `.dvpt-profiler-backup.json` *before anything is touched*, only your own assembly's steps are offered, a step with an un-restored backup is refused, and **Stop profiling…** verifies the restored step matches the backup byte-for-byte before the backup is dropped. **Repair profiled steps** restores everything from backup at any time.
  - **Download Captured Profiles** lists the environment's captured executions (persisted Plug-in Profile rows) and saves the picked ones into `profiles/`.
  - **Replay profile as unit test** generates a `Replay_<Type>_<timestamp>.cs` in your test project that deserializes the captured context (via the pinned Plugin Registration Tool assemblies, fetched on demand into `profiler-libs/`) and invokes your plugin's `Execute` **in-process** — set breakpoints and debug it from the Test Explorer like any other test. mstest/xunit/nunit supported. Windows test host (net462), same constraint the PRT has.
- **Settings migrations completed (#71).** The central runner (settingsVersion 2) now also: imports a legacy `spkl.json` into `solutionConfig`, moves `pluginModelBuilder` out to `modelbuilder.json`, and retires the solution template's `1.1` float version (now integer 2). Migrations run identically for the root and subfolder components.
- **Legacy plugin (<v3) policy (#71):** legacy template support is now **frozen** and will be **removed in 0.9.0**. Opening a legacy project shows the migration path: *Add Component → Plugins* (it offers to move the existing project into a subfolder first), then move your classes across.
- **Fixed: Testing pane showed passing web-resource runs as failed** when Jest's output contained braces before the JSON report (e.g. the ts-jest `globals` deprecation warning). The report is now located robustly.

### 0.7.5 (pre-release)

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

### 0.7.4 (pre-release)

- **Per-file web resource output (#88).** New projects choose at creation: the classic single bundled library (default) or **one JS web resource per TypeScript file** (`webresourceOutput: "perFile"` in `dataverse-powertools.json`). Per-file mode maps 1:1 with form libraries — each `webresources_src/*.ts` builds to `bin/<prefix>_<name>.js`, exports merged onto the `<prefix>` global so forms still call `<prefix>.Class.Function`; deploy pushes every built file. Known limitation: local debug interception currently targets the bundled library.
- **Settings schema version + central migrations (#71).** `dataverse-powertools.json` now carries an explicit integer `settingsVersion`; an ordered, idempotent migration runner upgrades settings on load (root AND subfolder components identically), and files written by a newer extension are detected with a warning instead of silently mis-handled. Legacy plugin (<v3) auto-upgrade remains tracked on #71.

### 0.7.3 (pre-release)

- **Power Pages as a first-class project type (#74).** The portal flow now runs on the shared `dataverse-powertools` pac auth profile (service principal or OAuth — no more ad-hoc `pac auth` juggling), with pure unit-tested `pac pages` argument builders and structured error reporting. **Upload is new**: round-trip a site with *Download from \<org\>* / *Upload* on the portal card. *Select site* remembers your Power Pages site (`portalWebsiteId`) so download/upload target it without re-picking; the download folder is configurable via `portalDownloadPath` (default `portalpublish`).

### 0.7.2 (pre-release)

- **Reliable live web-resource debugging (#96).** Re-running **Debug Web Resources** now stops the previous session and starts fresh (no more reload-VS-Code-between-runs); stopping the debugger from VS Code's toolbar tears down the whole stack (browser, webpack watch, CDP interception); breakpoints bind reliably to your TypeScript — the debug watch build forces `inline-source-map` even for projects whose `webpack.dev.js` still says `eval-source-map` (new projects scaffold with inline maps).
- **View Plugin Trace Logs (#63, phase 1).** Pull the latest `plugintracelog` records straight into VS Code: pick from a list (✔/✖, message, entity, duration) and read the formatted trace — metadata table, exception details, and the `ITracingService` output — as a markdown document. In the plugin card's ⋯ menu and the Command Palette. Profiler capture/replay is tracked on #63 for a later wave.

### 0.7.1 (pre-release)

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

- Fixed early-bound generation failing with `spawn EINVAL`: on Windows `pac` is a `.cmd` shim that recent Node versions refuse to spawn directly, so all `pac` calls (early-bound/model generator, portals, solutions) now run through `cmd.exe /c pac …`.
- Fixed plugin deploy failing with `spawn pwsh ENOENT`: the plugin package is now sanitized (forbidden SDK assemblies stripped) with an in-process zip library instead of shelling out to PowerShell, so it no longer requires PowerShell Core and works cross-platform.
- Fixed new Web Resources projects failing to create with an `npm ERESOLVE` error — TypeScript is now pinned to v5 (a bare install resolved to TypeScript 7, which conflicts with the ESLint TypeScript plugin's peer range).
- Fixed the early-bound side panel showing "error loading" until VS Code was reloaded after creating a project — the tree view provider is now registered immediately on project creation.
- Fixed typings generation failing with `XrmDefinitelyTyped.exe ENOENT`: new Web Resources projects now restore the `Delegate.XrmDefinitelyTyped` tool via paket (the restore step had been missing from the template), and the command now reports a clear, actionable error if the tool still isn't present.
- Fixed service-principal projects failing to reconnect on load ("Dataverse Not Connected", "Error refreshing authorization token", and broken typings): when reassembling the connection string from the stored settings and the secret-storage credentials, the client id was glued onto the URL with no separator (`Url=<url>ClientId=…`). The parts are now merged through the shared connection-string generator so the separators are always correct.
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
