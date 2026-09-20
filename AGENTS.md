# AGENTS.md — Dataverse PowerTools

Instructions for any coding agent working in this repo: what it is, how to verify a change, and
the traps. Reference material (architecture, test layers, e2e, cross-platform status) lives in
[docs/](docs/) and is linked below; current state is in [docs/STATE.md](docs/STATE.md).

## What this is

`dataverse-powertools` — a VS Code extension (TypeScript, webpack-bundled) that accelerates
Dataverse / Dynamics 365 / Power Platform development: scaffolding project templates, managing
project settings and connection context, build/deploy workflows per project type, and calling
Dataverse APIs from commands. Entry point: [src/extension.ts](src/extension.ts). Runtime state hangs
off `DataversePowerToolsContext` ([src/context.ts](src/context.ts)). The workspace-level config
file is `dataverse-powertools.json`. Project types live in the `ProjectTypes` enum
(`src/projectTypes/registry.ts`); feature modules are `src/<type>/`, templates in `templates/`.
Full architecture: [docs/architecture.md](docs/architecture.md).

## The verify loop — run these before saying a change works

```
npm run lint              # eslint (must be clean)
npm run compile           # webpack bundle -> dist/ (must succeed)
npm run test:unit         # Vitest, fast, no editor  (~<1s)
npm run test:coverage     # Vitest + a coverage floor CI enforces (see vitest.config.ts)
npm run test:integration  # real VS Code extension host (downloads VS Code once)
```

**`test:integration` does NOT rebuild the bundle.** It runs `compile-tests` (tsc → `out/`) and the
extension host loads `main` = `dist/extension.js`. So after changing anything under `src/` that the
*extension* runs (a provider, a registration, a command), run `npm run compile` first or the host
under test is your PREVIOUS build — a fix appears not to work, or a bug appears already fixed. Only
the test files themselves come from `out/`.

`npm test` = unit + integration. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))
runs lint + compile + `test:coverage` + `test:integration:coverage` on every PR, plus the UI tests.
**Publishing to the Marketplace is gated on these passing**
([.github/workflows/main.yml](.github/workflows/main.yml), triggered by a push to `main`) —
never merge to `main` red.

**Two coverage numbers, both regression guards, neither a target.** Unit coverage is high on
extracted pure modules and necessarily ~0 on everything `vscode`-tangled; the extension host is the
only thing that executes the tangled half. `npm run test:integration:coverage` reports the host's
coverage of `src/**` via [scripts/integrationCoverage.mjs](scripts/integrationCoverage.mjs) (the
floor lives there; `vitest.config.ts` holds the unit one). Ratchet both up as tests land — never
down. The integration number's *statement* percentage flatters the suite (every bundled module's top
level runs at require time); the FUNCTIONS percentage and the "no function ever entered" count the
script prints are the honest read.

## Testing — pick the cheapest layer that can catch the bug

1. **Unit (Vitest)** — `src/**/*.spec.ts`; `vscode` is aliased to [test/vscode.mock.ts](test/vscode.mock.ts).
   **Prefer extracting pure logic into a `vscode`-free module and unit-testing it** over reaching
   for the mock — untangling logic from the `vscode` API *is* the refactor.
2. **Integration (`@vscode/test-cli`)** — `src/test/suite/**/*.test.ts`, mocha `tdd`. Real extension host.
3. **UI (ExTester / Selenium)** — `src/ui-test/**/*.test.ts`, mocha `bdd`. Slowest; `npm run test:ui`.

Keep naming distinct so runners don't cross-pick: `.spec.ts` (unit) vs `.test.ts` under `test/suite`
(integration) vs `.test.ts` under `ui-test` (UI). Headless lifecycle suites: `npm run test:live`.
Literal-UI e2e: `npm run test:e2e:headless` on Linux (xvfb, not a VM). Full detail, e2e key facts,
host hygiene and the two e2e-authoring traps: [docs/testing-and-e2e.md](docs/testing-and-e2e.md).
Short form of the e2e rules that bite:
- Go through `scripts/runE2E.mjs`, never a bare `extest`; the interactive (OAuth) suites must stay green when you touch a Dataverse path.
- Gate each e2e step on the command's FINAL log line, not an intermediate artifact; select quick-pick items by keyboard, not coordinate click; assert no "resulted in an error" notification.
- Reap orphaned `webpack --watch`, ExTester VS Code and browser processes between runs (small hosts starve); never kill the owner's own VS Code.

## Changelog: two files

- **[CHANGELOG-prerelease.md](CHANGELOG-prerelease.md)** accumulates one section per **pre-release**
  version — where a normal PR's entry goes.
- **[CHANGELOG.md](CHANGELOG.md)** only gains a section per **full release** (it's what the
  Marketplace shows). At a full release run `node scripts/rollupChangelog.mjs <version> --summary "…"`:
  it folds every accumulated pre-release section under one `## <version>` heading and resets the
  pre-release file. `--dry-run` prints what it would move.

## Preview features (release gating)

Unverified features ship **off**, behind `dataverse-powertools.previewFeatures` (default false; a
checkbox sits next to *Show Log* in the panel footer). The list lives in ONE pure module —
[src/general/previewFeatures.ts](src/general/previewFeatures.ts) — and gates four surfaces, all of
which must agree:

1. the panel (project cards, card blocks, secondary/overflow buttons) via `PanelState.previewFeatures`,
2. the command palette, via `&& config.dataverse-powertools.previewFeatures` on each command's
   `enablement` in package.json (parity enforced by `previewFeatures.spec.ts`, both directions),
3. the Add Component / project-type quick picks (`visibleProjectTypes`),
4. anything else conditional in a feature module (e.g. the per-step Profile CodeLens).

Currently gated, each with its manual-test sign-off issue (also on the descriptor as
`manualTestIssue`): **Azure Functions** ([#223](https://github.com/pete-mc/dataverse-powertools/issues/223)),
**plug-in debugging** ([#224](https://github.com/pete-mc/dataverse-powertools/issues/224)),
**Custom APIs** ([#225](https://github.com/pete-mc/dataverse-powertools/issues/225)) and the
**FetchXML query tools** (`fetchXmlQueries`). The e2e/UI suites turn the flag ON via
[test/ui-settings.json](test/ui-settings.json). To un-gate a feature once signed off, delete its
entry from `PREVIEW_FEATURES` and drop the `config.…previewFeatures` clause from its commands in
package.json — the parity test tells you if you only did half.

## Traps specific to this repo

- **Commands are declared in two places.** A new command needs runtime registration (in the feature
  module's `initialise*`) **and** a `contributes` entry in [package.json](package.json). Menu/view
  visibility uses `when` clauses bound to context keys (`dataverse-powertools.showLoaded`, `.isPlugin`,
  …) set via `vscode.commands.executeCommand("setContext", ...)`. Change one, check the other, or the
  UI silently desyncs. If templates change, update `templates/<type>/template.json` and payload files
  together (no stale entries).
- **Every Dataverse command must work under BOTH auth types.** A connection is a service principal
  (client id/secret + tenant) **or** interactive (OAuth), which sets **no tenantId** — never gate a
  command on `projectSettings.tenantId` / `dataverse.tenantId`. Gate on the live connection
  (`canCallDataverseApi({ organizationUrl, isValid })` in
  [src/general/dataverse/connectionReady.ts](src/general/dataverse/connectionReady.ts)); the access
  token authorizes the call, not the tenant. This shipped broken three times (#91 typings, #90/register
  form events under interactive). The `*InteractiveLifecycle` e2e suites catch it — they must stay green.
- **A per-type `initialise*` runs ONCE PER COMPONENT — never register global singletons there.**
  Two components of the *same type* (#47) both run it, and anything with a fixed identity collides:
  `createTestController(id, …)` throws "duplicate controller with ID", `registerCommand(id, …)` throws
  "command … already exists". TestController ids are scoped per component (`scopedTestControllerId` +
  a dispose-on-reinit registry, in [pluginTestController.ts](src/plugins/pluginTestController.ts) /
  [webresourceTestController.ts](src/webresources/webresourceTestController.ts)); commands and CodeLens
  providers register ONCE globally in [extension.ts](src/extension.ts) / `registerAllComponentCommands`.
  **Both shipped in 0.8.4** and were caught by the two-of-each e2e, not by any unit test.
- **A scoped component's `writeSettings()` must not persist INHERITED fields.** Discovery
  ([resolveComponents](src/components/discovery.ts)) merges the root's connection/tenant/prefix/env into
  each subfolder component's in-memory settings. `writeSettings` strips `activeComponent.inheritedFields`
  before writing; otherwise the component gains its own `connectionString`, `resolveComponents` treats
  it as self-contained and it STOPS tracking the root's connection changes. Any command writing a
  subfolder component's settings (e.g. Switch Output Mode) hits this path.
- **Two components of the same type is a distinct test surface.** Invisible to unit tests and to a
  one-of-each e2e — the [blankRootComponents](src/ui-test/e2e/blankRootComponents.e2e.ts) suite adds TWO
  of every type and asserts targeting + no error notification. Keep it green when touching any per-type
  `initialise*`, discovery, or `runForComponent`.
- **Build/tests run the project's LOCAL bins via `npx`, never a bare `webpack`/`jest`.** The template
  installs them as devDependencies; a bare `webpack` only resolves a *global* install. See
  `WEBRESOURCE_BUILD_COMMAND` in [src/webresources/webpackBuild.ts](src/webresources/webpackBuild.ts).
  The production webpack build compiles against **`tsconfig.build.json`** (`types: []`, tests excluded)
  so it doesn't need `@types/jest` — don't reintroduce that coupling. `dotnet` is a real exe (spawn
  directly); `npx`/`jest`/`webpack`/`pac` are `.cmd` shims on Windows — go through `cmd.exe` or `npx`
  (the `spawn EINVAL` trap; see [src/general/pac.ts](src/general/pac.ts)).
- **System requirements are `dotnet` / `node` / `pac` only.** webpack/webpack-cli/jest/typescript are
  per-project local devDeps ([src/general/systemRequirements.ts](src/general/systemRequirements.ts)).
- **`src/plugins_old/` is GONE** (removed in 1.0.3, #228). Legacy template-v2 projects
  (`templateversion < 3`) get a migration notice and run the current `src/plugins/` path best-effort;
  the only legacy-aware bits left are that notice in [activation.ts](src/projectTypes/activation.ts) and
  the `isPluginV3` context key (which hides the v3-only earlybound surfaces).
- **Dataverse HTTP calls belong in `src/general/dataverse/`** (helper classes), not scattered in feature files.
- **Secrets never go in `dataverse-powertools.json`** — client id/secret live in VS Code secret
  storage; the settings file holds the non-secret connection base (merged at load time).
- **Persist new workspace settings** in `projectSettings` and `dataverse-powertools.json`; user-level
  settings (`contributes.configuration`) are read only through `src/general/extensionConfig.ts` — no
  string-literal setting ids elsewhere.
- **`tsconfig.json` is scoped to `src/**`** and sets no `noEmitOnError`, so a tsc error can still emit
  stray `.js`. If you see stray compiled files at the repo root, delete them.
- **Publish package hygiene:** [.vscodeignore](.vscodeignore) excludes `samples/`, `originalTemplates/`,
  tests and dev config from the VSIX. A new dev-only folder must be added there too.
- Keep project-type logic in its module (`src/webresources`, `src/plugins`, …). Keep `when`
  expressions in package.json aligned with runtime context keys.

## Cross-platform rules

Plugins *target* .NET Framework 4.6.2 (moving to net48 ~Q4 2026) but `dotnet build` compiles net462
on any OS; nothing requires Windows. Detail and history: [docs/cross-platform.md](docs/cross-platform.md).

- **Never hand-concatenate paths.** Use `path.join` or [src/general/paths.ts](src/general/paths.ts).
- **Solutions use `pac`** (`pac solution pack/unpack/export/import`), not `spkl.exe`; `spkl.json` is
  only a config file now. Single named pac profile `dataverse-powertools`, recreated per run. Pure arg
  builders in [src/solution/pacArgs.ts](src/solution/pacArgs.ts) — add/verify flags there.
- **Typings** = bundled net8 XrmDefinitelyTyped via `dotnet`, token-authenticated via `DVPT_TOKEN`
  (no client secret, no `.exe`); the tool isn't committed — `scripts/fetchTypingsTool.mjs` fetches it
  into `tools/` on install/prepublish.
- **Profiler `configuration` blob is a contract** with the profiler's server-side plug-in
  (`DataContractSerializer`; members ALPHABETICAL, unset ones `i:nil`); `profilerSteps.spec.ts` pins the
  exact bytes. **Don't "tidy" that emitter.** Enable also MOVES the step's images to the clone and
  DISABLES the original — miss either and the profiler silently never fires.
- **Replay multi-targets `net462;net8.0`** so the test project can be net8.0. Only the DEPLOYED
  assembly is net462. Three things must stay true (each has a test):
  - `DvptDeployBuild=true` on BOTH `dotnet build` and `dotnet pack` in
    [buildAndDeploy.ts](src/plugins/buildAndDeploy.ts) (else a stray `net8.0` nuspec group and NU5128).
  - `ensureReplayCsproj` is TFM-aware: a modern test project takes Microsoft.Xrm.Sdk from the
    netstandard `Microsoft.PowerPlatform.Dataverse.Client`, NOT `Microsoft.CrmSdk.CoreAssemblies`.
  - A test project pinned to Framework by its OWN references (`FakeXrmEasy.9`, `Microsoft.CrmSdk.*`) is
    left alone.
  Guard: [test/live/replayHarnessNet8.spec.ts](test/live/replayHarnessNet8.spec.ts) (no org, no credentials).
- **Still Windows-only:** just the replay step in `test/live/pluginProfilerCaptureLifecycle.spec.ts`
  (a cross-check against Microsoft's net462 profiler engine). Nothing else pins `spkl.exe`/`sn.exe`.

## Test Explorer (#84)
A `TestController` per COMPONENT is created in the feature `initialise*` (id scoped via
`scopedTestControllerId`, stale one disposed on re-discovery). Result/discovery **parsers are pure and
unit-tested** (`parseTrx`, `parseDotnetListTests`, `parseJestJson`) — keep parsing logic there, not in
the controllers. Web-resource continuous run re-runs through the ordinary one-shot jest path, NEVER
`jest --watch` (a long-lived watcher child starves the e2e host); the re-run decision is the pure
[continuousRun.ts](src/webresources/continuousRun.ts). Detail: [docs/testing-and-e2e.md](docs/testing-and-e2e.md).

## GitHub issues & wiki

- **Issues/PRs:** use the `gh` CLI. The wiki is a separate git repo cloned as a sibling at
  `../dataverse-powertools.wiki` (granted to the agent via `permissions.additionalDirectories` in
  `.claude/settings.local.json`) — edit it in place and push to its own `…wiki.git` remote.
- Check the wiki before assuming a docs gap is open (the spkl→`pac` and multi-component gaps, #233,
  are closed).
- Open housekeeping (stale remote release branches, unproven credentialed Linux e2e): [docs/STATE.md](docs/STATE.md).
